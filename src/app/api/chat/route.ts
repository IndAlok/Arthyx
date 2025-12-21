import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings, generateChatResponse, ChatMessage, SourceContext } from "@/lib/gemini";
import { queryDocuments } from "@/lib/pinecone";
import { getSession, addMessage } from "@/lib/redis";

export const maxDuration = 30;

const log = (step: string, data?: object) => {
  console.log(`[CHAT] ${step}`, data ? JSON.stringify(data) : "");
};

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();
    log("Chat request", { sessionId, messageLength: message?.length });

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "Message and sessionId are required" },
        { status: 400 }
      );
    }

    const session = await getSession(sessionId);
    if (!session) {
      log("Session not found", { sessionId });
      return NextResponse.json(
        { error: "Session not found. Please upload documents first." },
        { status: 404 }
      );
    }

    log("Session found", { documents: session.documents });

    log("Generating query embedding");
    const [queryEmbedding] = await generateEmbeddings([message]);

    log("Querying documents with session filter");
    const searchResults = await queryDocuments(queryEmbedding, sessionId, 15);

    const sources: SourceContext[] = searchResults.map((result) => {
      const metadata = result.metadata as {
        content?: string;
        filename?: string;
        pageNumber?: number;
        chunkIndex?: number;
      };

      return {
        filename: metadata.filename || "Unknown",
        pageNumber: metadata.pageNumber || 1,
        excerpt: (metadata.content || "").substring(0, 400),
        relevanceScore: result.score || 0,
        chunkIndex: metadata.chunkIndex,
      };
    });

    log("Sources retrieved", { count: sources.length });

    const history: ChatMessage[] = session.messages.slice(-6).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      content: m.content,
    }));
    history.push({ role: "user", content: message });

    log("Generating response");
    const { response, citedSources, chartConfig } = await generateChatResponse(
      history,
      sources,
      session.documents || []
    );

    await addMessage(sessionId, {
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    await addMessage(sessionId, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
      sources: citedSources.slice(0, 5).map((s) => ({
        filename: s.filename,
        pageNumber: s.pageNumber,
        excerpt: s.excerpt,
      })),
    });

    log("Response complete", { 
      responseLength: response.length,
      sourcesCount: citedSources.length,
      hasChart: !!chartConfig 
    });

    return NextResponse.json({
      success: true,
      response,
      sources: citedSources.map((s) => ({
        filename: s.filename,
        pageNumber: s.pageNumber,
        excerpt: s.excerpt,
        relevanceScore: s.relevanceScore,
      })),
      chartConfig,
      documentsAvailable: session.documents || [],
    });
  } catch (error) {
    log("Chat error", { error: String(error) });
    return NextResponse.json(
      { error: "Failed to process message", details: String(error) },
      { status: 500 }
    );
  }
}

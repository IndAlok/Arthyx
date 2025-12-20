import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings, generateChatResponse, ChatMessage } from "@/lib/gemini";
import { queryDocuments } from "@/lib/pinecone";
import { getSession, addMessage, ConversationMessage } from "@/lib/redis";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "Message and sessionId are required" },
        { status: 400 }
      );
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found. Please upload documents first." },
        { status: 404 }
      );
    }

    const [queryEmbedding] = await generateEmbeddings([message]);

    const searchResults = await queryDocuments(queryEmbedding, 8);

    const contextParts = searchResults.map((result) => {
      const metadata = result.metadata as {
        content?: string;
        filename?: string;
        pageNumber?: number;
      };
      return `[Source: ${metadata.filename}, Page ${metadata.pageNumber}]\n${metadata.content}`;
    });
    const context = contextParts.join("\n\n---\n\n");

    const sources = searchResults.map((result) => {
      const metadata = result.metadata as {
        content?: string;
        filename?: string;
        pageNumber?: number;
        boundingBox?: string;
      };
      return {
        filename: metadata.filename || "Unknown",
        pageNumber: metadata.pageNumber || 1,
        excerpt: (metadata.content || "").substring(0, 200),
        boundingBox: metadata.boundingBox
          ? JSON.parse(metadata.boundingBox)
          : null,
        score: result.score || 0,
      };
    });

    const history: ChatMessage[] = session.messages.slice(-6).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      content: m.content,
    }));
    history.push({ role: "user", content: message });

    const response = await generateChatResponse(history, context);

    await addMessage(sessionId, {
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    await addMessage(sessionId, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
      sources: sources.slice(0, 3).map((s) => ({
        filename: s.filename,
        pageNumber: s.pageNumber,
        excerpt: s.excerpt,
      })),
    });

    let chartConfig = null;
    const chartMatch = response.match(/\{"chart":\s*\{[^}]+\}\}/);
    if (chartMatch) {
      try {
        chartConfig = JSON.parse(chartMatch[0]).chart;
      } catch {
        // Not valid chart JSON
      }
    }

    return NextResponse.json({
      success: true,
      response,
      sources,
      chartConfig,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to process message", details: String(error) },
      { status: 500 }
    );
  }
}

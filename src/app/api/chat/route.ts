import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings, generateChatResponse, generateWithoutDocuments, ChatMessage, SourceContext } from "@/lib/gemini";
import { queryDocuments } from "@/lib/pinecone";
import { getSession, addMessage } from "@/lib/redis";
import { getSessionGraph } from "@/lib/neo4j";
import { extractFinancialMetrics, generateRiskReport } from "@/lib/risk-analyzer";

export const maxDuration = 30;

const log = (step: string, data?: object) => {
  console.log(`[CHAT] ${step}`, data ? JSON.stringify(data) : "");
};

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, isEdit, originalMessageId } = await request.json();
    log("Chat request", { sessionId, messageLength: message?.length, isEdit });

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    let session = null;
    let hasDocuments = false;
    let sources: SourceContext[] = [];
    let documentFilenames: string[] = [];
    let graphData = null;

    if (sessionId) {
      session = await getSession(sessionId);
      if (session && session.documents && session.documents.length > 0) {
        hasDocuments = true;
        documentFilenames = session.documents;
        log("Session found", { documents: documentFilenames });

        log("Generating query embedding");
        const [queryEmbedding] = await generateEmbeddings([message]);

        log("Querying documents with session filter");
        const searchResults = await queryDocuments(queryEmbedding, sessionId, 25);

        sources = searchResults.map((result) => {
          const metadata = result.metadata as {
            content?: string;
            filename?: string;
            pageNumber?: number;
            chunkIndex?: number;
          };

          return {
            filename: metadata.filename || "Unknown",
            pageNumber: metadata.pageNumber || 1,
            excerpt: (metadata.content || "").substring(0, 500),
            relevanceScore: result.score || 0,
            chunkIndex: metadata.chunkIndex,
          };
        });

        log("Sources retrieved", { count: sources.length });

        try {
          graphData = await getSessionGraph(sessionId);
          log("Knowledge graph retrieved", { 
            nodes: graphData.nodes.length, 
            edges: graphData.edges.length 
          });
        } catch (graphError) {
          log("Graph retrieval skipped", { error: String(graphError) });
        }
      }
    }

    const history: ChatMessage[] = [];
    
    if (session && session.messages) {
      const messagesToInclude = isEdit ? 
        session.messages.filter((m) => m.id !== originalMessageId).slice(-6) :
        session.messages.slice(-6);
      
      history.push(...messagesToInclude.map((m) => ({
        role: (m.role === "user" ? "user" : "model") as "user" | "model",
        content: m.content,
      })));
    }
    
    history.push({ role: "user", content: message });

    log("Generating response", { hasDocuments, historyLength: history.length });
    
    const result = hasDocuments
      ? await generateChatResponse(history, sources, documentFilenames, true)
      : await generateWithoutDocuments(history);

    let additionalRiskAnalysis = undefined;
    let additionalMetrics = undefined;

    if (hasDocuments && sources.length > 0) {
      const combinedText = sources.map(s => s.excerpt).join("\n");
      const financialMetrics = extractFinancialMetrics(combinedText);
      
      if (financialMetrics.ratios.length > 0) {
        const entityList = result.entities?.map(e => ({ 
          type: e.type as "company" | "regulation" | "person" | "amount" | "date" | "sector", 
          name: e.name 
        })) || [];
        const riskReport = generateRiskReport(financialMetrics, entityList);
        
        if (!result.riskAnalysis && riskReport.factors.length > 0) {
          additionalRiskAnalysis = riskReport;
        }
        
        if (!result.metrics && financialMetrics.ratios.length > 0) {
          additionalMetrics = financialMetrics.ratios.map(r => ({
            name: r.name,
            value: r.value,
            unit: r.name.includes("Ratio") ? "" : "%",
          }));
        }
      }
    }

    if (sessionId) {
      const messageId = `msg_${Date.now()}`;
      
      await addMessage(sessionId, {
        id: messageId,
        role: "user",
        content: message,
        timestamp: Date.now(),
        isEdit: isEdit || false,
      });

      await addMessage(sessionId, {
        id: `${messageId}_response`,
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
        sources: result.citedSources.slice(0, 5).map((s) => ({
          filename: s.filename,
          pageNumber: s.pageNumber,
          excerpt: s.excerpt,
        })),
      });
    }

    log("Response complete", { 
      responseLength: result.response.length,
      sourcesCount: result.citedSources.length,
      hasChart: !!result.chartConfig,
      hasRisk: !!(result.riskAnalysis || additionalRiskAnalysis),
      hasMetrics: !!(result.metrics || additionalMetrics),
      hasDocumentContext: result.hasDocumentContext
    });

    return NextResponse.json({
      success: true,
      response: result.response,
      sources: result.citedSources.map((s) => ({
        filename: s.filename,
        pageNumber: s.pageNumber,
        excerpt: s.excerpt,
        relevanceScore: s.relevanceScore,
      })),
      chartConfig: result.chartConfig,
      riskAnalysis: result.riskAnalysis || additionalRiskAnalysis,
      metrics: result.metrics || additionalMetrics,
      entities: result.entities,
      graphData,
      hasDocuments,
      documentsAvailable: documentFilenames,
    });
  } catch (error) {
    log("Chat error", { error: String(error) });
    return NextResponse.json(
      { error: "Failed to process message", details: String(error) },
      { status: 500 }
    );
  }
}

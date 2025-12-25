import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings, generateChatResponse, generateWithoutDocuments, ChatMessage, SourceContext } from "@/lib/gemini";
import { queryDocuments } from "@/lib/pinecone";
import { getSession, addMessage } from "@/lib/redis";
import { getSessionGraph } from "@/lib/neo4j";
import { extractFinancialMetrics, generateRiskReport } from "@/lib/risk-analyzer";
import { queryWithLlamaIndex } from "@/lib/llamaindex-rag";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, isEdit, originalMessageId } = await request.json();

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

        const [queryEmbedding] = await generateEmbeddings([message]);

        const searchResults = await queryDocuments(queryEmbedding, sessionId, 25);

        sources = searchResults.map((result) => {
          const metadata = result.metadata as {
            content?: string;
            text?: string;
            filename?: string;
            pageNumber?: number;
            chunkIndex?: number;
            type?: string;
          };

          return {
            filename: metadata.filename || "Unknown",
            pageNumber: metadata.pageNumber || 1,
            excerpt: (metadata.content || metadata.text || "").substring(0, 500),
            relevanceScore: result.score || 0,
            chunkIndex: metadata.chunkIndex,
          };
        });

        try {
          const llamaResult = await queryWithLlamaIndex(message, sessionId, { topK: 5 });
          
          if (llamaResult.sources.length > 0) {
            const llamaSources = llamaResult.sources.map(s => ({
              filename: documentFilenames[0] || "Document",
              pageNumber: s.pageNumber,
              excerpt: s.text.substring(0, 500),
              relevanceScore: s.score,
              chunkIndex: 0,
              type: s.type,
            }));
            
            const existingPages = new Set(sources.map(s => s.pageNumber));
            for (const ls of llamaSources) {
              if (!existingPages.has(ls.pageNumber)) {
                sources.push(ls);
              }
            }
          }
        } catch (llamaError) {
          // Continue without LlamaIndex sources if error
        }

        try {
          graphData = await getSessionGraph(sessionId);
        } catch (graphError) {
          // Continue without graph data if error
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
    return NextResponse.json(
      { error: "Failed to process message", details: String(error) },
      { status: 500 }
    );
  }
}

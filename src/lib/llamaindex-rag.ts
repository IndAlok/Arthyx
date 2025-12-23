import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[LLAMAINDEX][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

export interface RAGQueryResult {
  response: string;
  sources: RAGSource[];
  confidence: number;
}

export interface RAGSource {
  pageNumber: number;
  text: string;
  score: number;
  type: "text" | "table";
}

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getPineconeClient() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY not configured");
  return new Pinecone({ apiKey });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function queryWithLlamaIndex(
  query: string,
  sessionId: string,
  options: { topK?: number; includeMetadata?: boolean } = {}
): Promise<RAGQueryResult> {
  const { topK = 5, includeMetadata = true } = options;

  log("Starting RAG query", { query: query.substring(0, 50), sessionId, topK });
  const startTime = Date.now();

  try {
    const queryEmbedding = await generateEmbedding(query);

    const pinecone = getPineconeClient();
    const index = pinecone.index("arthyx");

    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata,
      filter: { sessionId: { $eq: sessionId } },
    });

    const sources: RAGSource[] = queryResponse.matches?.map(match => ({
      pageNumber: (match.metadata?.pageNumber as number) || 0,
      text: (match.metadata?.text as string) || "",
      score: match.score || 0,
      type: ((match.metadata?.type as string) || "text") as "text" | "table",
    })) || [];

    log("Retrieved sources", { count: sources.length, topScore: sources[0]?.score });

    if (sources.length === 0) {
      return {
        response: "",
        sources: [],
        confidence: 0,
      };
    }

    const context = sources
      .map((s, i) => `[Source ${i + 1}, Page ${s.pageNumber}]:\n${s.text}`)
      .join("\n\n");

    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const systemPrompt = `You are an expert financial analyst assistant. Answer questions based ONLY on the provided context from financial documents.

RULES:
1. Always cite sources with [Page X] format
2. For numerical data, quote exact figures from the document
3. If the answer is not in the context, say "I couldn't find this information in the uploaded documents"
4. For tables, present data in markdown format
5. Be precise with financial metrics (NPA, CAR, ROE, etc.)

CONTEXT FROM DOCUMENTS:
${context}

USER QUESTION: ${query}`;

    const result = await model.generateContent(systemPrompt);
    const response = result.response.text();

    const avgScore = sources.length > 0 
      ? sources.reduce((sum, s) => sum + s.score, 0) / sources.length 
      : 0;

    log("Query complete", {
      sources: sources.length,
      responseLength: response.length,
      avgScore: avgScore.toFixed(3),
      duration: Date.now() - startTime,
    });

    return {
      response,
      sources,
      confidence: avgScore,
    };
  } catch (error) {
    log("Query error", { error: String(error) });
    return {
      response: "",
      sources: [],
      confidence: 0,
    };
  }
}

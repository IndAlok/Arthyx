import {
  Document,
  VectorStoreIndex,
  Settings,
  SimpleNodeParser,
  MetadataMode,
  NodeWithScore,
} from "llamaindex";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import { VisionExtractionResult, VisionTable } from "./cloud-vision";

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[LLAMAINDEX][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

export interface RAGIndexResult {
  indexId: string;
  documentCount: number;
  chunkCount: number;
  metadata: {
    filename: string;
    pages: number;
    tables: number;
    languages: string[];
  };
}

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

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

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

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
}

function createDocumentsFromVisionResult(
  visionResult: VisionExtractionResult,
  filename: string
): Document[] {
  const documents: Document[] = [];

  for (const page of visionResult.pages) {
    if (page.text.trim().length < 50) continue;

    documents.push(
      new Document({
        text: page.text,
        metadata: {
          filename,
          pageNumber: page.pageNumber,
          type: "text",
          languages: visionResult.languages.join(","),
        },
      })
    );
  }

  for (const table of visionResult.tables) {
    documents.push(
      new Document({
        text: table.markdown,
        metadata: {
          filename,
          pageNumber: table.pageNumber,
          type: "table",
          headers: table.headers.join(","),
        },
      })
    );
  }

  log("Documents created from Vision result", {
    textDocs: visionResult.pages.length,
    tableDocs: visionResult.tables.length,
    total: documents.length,
  });

  return documents;
}

function chunkDocument(doc: Document): Document[] {
  const text = doc.getText();
  const chunks: Document[] = [];
  
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    let chunkEnd = end;
    
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + CHUNK_SIZE / 2) {
        chunkEnd = breakPoint + 1;
      }
    }

    const chunkText = text.slice(start, chunkEnd).trim();
    if (chunkText.length > 20) {
      chunks.push(
        new Document({
          text: chunkText,
          metadata: {
            ...doc.metadata,
            chunkIndex: chunks.length,
            chunkStart: start,
          },
        })
      );
    }

    start = chunkEnd - CHUNK_OVERLAP;
    if (start >= text.length - 20) break;
  }

  return chunks;
}

export async function indexDocumentWithLlamaIndex(
  visionResult: VisionExtractionResult,
  filename: string,
  sessionId: string
): Promise<RAGIndexResult> {
  log("Starting LlamaIndex indexing", { filename, sessionId, pages: visionResult.pages.length });
  const startTime = Date.now();

  const documents = createDocumentsFromVisionResult(visionResult, filename);
  
  const allChunks: Document[] = [];
  for (const doc of documents) {
    const chunks = chunkDocument(doc);
    allChunks.push(...chunks);
  }

  log("Chunks created", { totalChunks: allChunks.length });

  const pinecone = getPineconeClient();
  const index = pinecone.index("financial-docs");

  const batchSize = 10;
  let upsertedCount = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.getText());
    const embeddings = await generateEmbeddings(texts);

    const vectors = batch.map((chunk, idx) => ({
      id: `${sessionId}_${filename.replace(/[^a-zA-Z0-9]/g, "_")}_chunk_${i + idx}`,
      values: embeddings[idx],
      metadata: {
        text: chunk.getText().substring(0, 1000),
        filename: chunk.metadata.filename as string,
        pageNumber: chunk.metadata.pageNumber as number,
        type: chunk.metadata.type as string,
        sessionId,
        chunkIndex: i + idx,
      },
    }));

    await index.upsert(vectors);
    upsertedCount += vectors.length;

    log("Batch upserted", { batch: Math.floor(i / batchSize) + 1, total: Math.ceil(allChunks.length / batchSize), upserted: upsertedCount });
  }

  log("Indexing complete", {
    filename,
    sessionId,
    chunks: allChunks.length,
    duration: Date.now() - startTime,
  });

  return {
    indexId: sessionId,
    documentCount: documents.length,
    chunkCount: allChunks.length,
    metadata: {
      filename,
      pages: visionResult.pages.length,
      tables: visionResult.tables.length,
      languages: visionResult.languages,
    },
  };
}

export async function queryWithLlamaIndex(
  query: string,
  sessionId: string,
  options: { topK?: number; includeMetadata?: boolean } = {}
): Promise<RAGQueryResult> {
  const { topK = 5, includeMetadata = true } = options;

  log("Starting RAG query", { query: query.substring(0, 50), sessionId, topK });
  const startTime = Date.now();

  const queryEmbedding = await generateEmbedding(query);

  const pinecone = getPineconeClient();
  const index = pinecone.index("financial-docs");

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
}

export async function buildFinancialKnowledgeGraph(
  visionResult: VisionExtractionResult,
  sessionId: string
): Promise<{ entities: string[]; relationships: string[] }> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Analyze this financial document and extract entities and relationships for a knowledge graph.

DOCUMENT TEXT (first 5000 chars):
${visionResult.fullText.substring(0, 5000)}

TABLES:
${visionResult.tables.map(t => t.markdown).join("\n\n").substring(0, 2000)}

OUTPUT FORMAT (JSON):
{
  "entities": [
    {"name": "Entity Name", "type": "COMPANY|METRIC|YEAR|REGULATION", "value": "optional value"}
  ],
  "relationships": [
    {"from": "Entity1", "to": "Entity2", "type": "HAS_METRIC|REGULATED_BY|YEAR_DATA"}
  ]
}

Extract key financial entities and their relationships:`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        entities: parsed.entities?.map((e: any) => `${e.type}:${e.name}`) || [],
        relationships: parsed.relationships?.map((r: any) => `${r.from} -[${r.type}]-> ${r.to}`) || [],
      };
    }
  } catch (error) {
    log("KG extraction error", { error: String(error) });
  }

  return { entities: [], relationships: [] };
}

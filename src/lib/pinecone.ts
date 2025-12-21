import { Pinecone } from "@pinecone-database/pinecone";

let pineconeInstance: Pinecone | null = null;

const log = (step: string, data?: object) => {
  console.log(`[PINECONE] ${step}`, data ? JSON.stringify(data) : "");
};

export function getPineconeClient(): Pinecone {
  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pineconeInstance;
}

export async function getIndex() {
  const client = getPineconeClient();
  return client.index("arthyx", process.env.PINECONE_INDEX_HOST);
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    filename: string;
    pageNumber: number;
    sessionId?: string;
    chunkIndex?: number;
    totalChunks?: number;
  };
  embedding?: number[];
}

export async function upsertDocumentChunks(
  chunks: DocumentChunk[],
  embeddings: number[][],
  sessionId: string
) {
  const index = await getIndex();
  
  const vectors = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: {
      content: chunk.content,
      filename: chunk.metadata.filename,
      pageNumber: chunk.metadata.pageNumber,
      sessionId: sessionId,
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));

  log("Upserting vectors", { count: vectors.length, sessionId });
  await index.upsert(vectors);
  log("Upsert complete");
}

export async function queryDocuments(
  queryEmbedding: number[],
  sessionId: string,
  topK: number = 15
) {
  const index = await getIndex();
  
  log("Querying documents", { sessionId, topK });
  
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
    filter: {
      sessionId: { $eq: sessionId },
    },
  });
  
  const matches = results.matches || [];
  log("Query results", { 
    matchCount: matches.length,
    topScore: matches[0]?.score 
  });
  
  return matches;
}

export async function deleteSessionDocuments(sessionId: string) {
  const index = await getIndex();
  log("Deleting session documents", { sessionId });
  
  try {
    await index.deleteMany({
      filter: { sessionId: { $eq: sessionId } },
    });
    log("Session documents deleted");
  } catch (error) {
    log("Delete error", { error: String(error) });
  }
}

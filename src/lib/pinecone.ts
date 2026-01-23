const log = (step: string, data?: object) => {
  console.log(`[PINECONE] ${step}`, data ? JSON.stringify(data) : "");
};

function getPineconeApiKey(): string {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error("PINECONE_API_KEY not configured");
  }
  return apiKey;
}

function getPineconeBaseUrl(): string {
  const host = process.env.PINECONE_INDEX_HOST;
  if (!host) {
    throw new Error(
      "PINECONE_INDEX_HOST not configured (expected the Pinecone index host URL)"
    );
  }

  const normalizedHost = host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

  return `https://${normalizedHost}`;
}

async function pineconeRequest<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const url = `${getPineconeBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const apiKey = getPineconeApiKey();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinecone request failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as TResponse;
}

export interface PineconeVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
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

export async function upsertVectors(vectors: PineconeVector[]): Promise<void> {
  if (vectors.length === 0) return;
  await pineconeRequest("/vectors/upsert", { vectors });
}

export async function upsertDocumentChunks(
  chunks: DocumentChunk[],
  embeddings: number[][],
  sessionId: string
) {
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
  await upsertVectors(vectors);
  log("Upsert complete");
}

export async function queryDocuments(
  queryEmbedding: number[],
  sessionId: string,
  topK: number = 15
) {
  log("Querying documents", { sessionId, topK });

  const results = await pineconeRequest<{ matches?: Array<Record<string, any>> }>("/query", {
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
  log("Deleting session documents", { sessionId });
  
  try {
    await pineconeRequest("/vectors/delete", {
      filter: { sessionId: { $eq: sessionId } },
    });
    log("Session documents deleted");
  } catch (error) {
    log("Delete error", { error: String(error) });
  }
}

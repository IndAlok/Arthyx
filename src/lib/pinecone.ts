import { Pinecone } from "@pinecone-database/pinecone";

let pineconeInstance: Pinecone | null = null;

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
    boundingBox?: { x: number; y: number; width: number; height: number };
  };
  embedding?: number[];
}

export async function upsertDocumentChunks(
  chunks: DocumentChunk[],
  embeddings: number[][]
) {
  const index = await getIndex();
  const vectors = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: {
      content: chunk.content,
      filename: chunk.metadata.filename,
      pageNumber: chunk.metadata.pageNumber,
      boundingBox: JSON.stringify(chunk.metadata.boundingBox || {}),
    },
  }));

  await index.upsert(vectors);
}

export async function queryDocuments(
  queryEmbedding: number[],
  topK: number = 5,
  filter?: Record<string, string>
) {
  const index = await getIndex();
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
    filter,
  });
  return results.matches || [];
}

export async function deleteDocumentsByFilename(filename: string) {
  const index = await getIndex();
  await index.deleteMany({ filename: { $eq: filename } });
}

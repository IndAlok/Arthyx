import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import { createSession, addDocument, updateJobStatus } from "@/lib/redis";
import { extractEntitiesFromText } from "@/lib/neo4j";

export const runtime = "edge";

export const maxDuration = 300;

const CHUNK_SIZE = 2000;
const MAX_RETRIES = 3;

function calculateOptimalBatchSize(
  totalPages: number,
  fileSizeMB: number,
): number {
  if (totalPages <= 5) return totalPages;
  if (fileSizeMB > 30) return 5;
  if (fileSizeMB > 15) return 8;
  if (totalPages > 100) return 10;
  return 12;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + CHUNK_SIZE / 2) {
        end = breakPoint + 1;
      }
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit =
        String(error).includes("429") ||
        String(error).includes("Resource exhausted");
      if (attempt === retries) throw error;
      const delay = isRateLimit ? 20000 * attempt : 2000 * attempt;
      await sleep(delay);
    }
  }
  throw new Error("Failed after retries");
}

async function extractPagesWithGemini(
  pdfBytes: ArrayBuffer,
  startPage: number,
  endPage: number,
  genAI: GoogleGenerativeAI,
): Promise<string> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const actualEnd = Math.min(pageCount, endPage);

  const pagesToCopy = [];
  for (let i = startPage; i < actualEnd; i++) {
    pagesToCopy.push(i);
  }

  if (pagesToCopy.length === 0) return "";

  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
  copiedPages.forEach((page) => newPdf.addPage(page));
  const batchPdfBytes = await newPdf.save();
  const base64Pdf = Buffer.from(batchPdfBytes).toString("base64");

  return withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      `Extract ALL text from this PDF (pages ${startPage + 1}-${actualEnd}). Mark each page as === PAGE X ===. Extract every word, number, table exactly. Tables: markdown | format. Do NOT summarize.`,
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    ]);
    return result.response.text();
  });
}

async function generateBatchEmbeddings(
  chunks: string[],
  genAI: GoogleGenerativeAI,
): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const embeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += 5) {
    const batch = chunks.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (chunk) => {
        const truncated = chunk.substring(0, 1500);
        const result = await model.embedContent(truncated);
        return result.embedding.values;
      }),
    );
    embeddings.push(...results);
    if (i + 5 < chunks.length) await sleep(100);
  }

  return embeddings;
}

async function processDocumentBackground(
  jobId: string,
  blobUrl: string,
  filename: string,
  sessionId: string,
) {
  const startTime = Date.now();

  try {
    await updateJobStatus(jobId, {
      status: "processing",
      progress: 0,
      message: "Fetching document...",
    });

    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const pdfBytes = await response.arrayBuffer();
    const fileSizeMB = pdfBytes.byteLength / (1024 * 1024);

    const tempDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });
    const totalPages = tempDoc.getPageCount();

    const pagesPerBatch = calculateOptimalBatchSize(totalPages, fileSizeMB);
    const numBatches = Math.ceil(totalPages / pagesPerBatch);

    await updateJobStatus(jobId, {
      progress: 2,
      message: `Processing ${totalPages} pages (${fileSizeMB.toFixed(1)}MB) in ${numBatches} batches of ${pagesPerBatch} pages...`,
    });

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index("arthyx");

    let totalChunks = 0;
    let totalTextLength = 0;
    let sampleTextForKnowledgeGraph = "";

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const startPage = batchIdx * pagesPerBatch;
      const endPage = Math.min((batchIdx + 1) * pagesPerBatch, totalPages);
      const progress = 5 + Math.floor(((batchIdx + 1) / numBatches) * 85);

      await updateJobStatus(jobId, {
        progress,
        message: `Extracting pages ${startPage + 1}-${endPage} of ${totalPages}...`,
      });

      try {
        const batchText = await extractPagesWithGemini(
          pdfBytes,
          startPage,
          endPage,
          genAI,
        );
        totalTextLength += batchText.length;

        if (sampleTextForKnowledgeGraph.length < 15000) {
          sampleTextForKnowledgeGraph += batchText.substring(0, 5000);
        }

        const chunks = chunkText(batchText);
        if (chunks.length === 0) continue;

        await updateJobStatus(jobId, {
          progress,
          message: `Embedding ${chunks.length} chunks from pages ${startPage + 1}-${endPage}...`,
        });

        const embeddings = await generateBatchEmbeddings(chunks, genAI);

        const vectors = chunks.map((chunk, i) => ({
          id: `${sessionId}_p${startPage}_c${i}`,
          values: embeddings[i],
          metadata: {
            text: chunk.substring(0, 8000),
            content: chunk.substring(0, 8000),
            filename,
            pageNumber: startPage + 1 + Math.floor(i / 3),
            sessionId,
          },
        }));

        for (let i = 0; i < vectors.length; i += 50) {
          await index.upsert(vectors.slice(i, i + 50));
        }

        totalChunks += chunks.length;

        if (batchIdx < numBatches - 1 && batchIdx % 3 === 2) {
          await sleep(1000);
        }
      } catch (batchError) {
        console.log(
          `[DIRECT-UPLOAD] Batch ${batchIdx} error:`,
          String(batchError).substring(0, 150),
        );
      }
    }

    await updateJobStatus(jobId, {
      progress: 92,
      message: "Building knowledge graph...",
    });

    try {
      const { entities, relationships } = await extractEntitiesFromText(
        sampleTextForKnowledgeGraph,
        sessionId,
      );
      console.log(
        `[DIRECT-UPLOAD] Knowledge graph: ${entities.length} entities, ${relationships.length} relationships`,
      );
    } catch (kgError) {
      console.log(
        `[DIRECT-UPLOAD] Knowledge graph error:`,
        String(kgError).substring(0, 100),
      );
    }

    const duration = Date.now() - startTime;
    const pagesPerSecond = (totalPages / (duration / 1000)).toFixed(2);

    await updateJobStatus(jobId, {
      status: "completed",
      progress: 100,
      message: `Complete! ${totalPages} pages processed in ${Math.round(duration / 1000)}s (${pagesPerSecond} pages/sec)`,
      result: {
        sessionId,
        filename,
        pages: totalPages,
        chunks: totalChunks,
        textLength: totalTextLength,
        duration,
        pagesPerSecond: parseFloat(pagesPerSecond),
      },
    });
  } catch (error) {
    await updateJobStatus(jobId, {
      status: "failed",
      error: String(error),
      message: "Processing failed. Please try again.",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blobUrl, filename, sessionId: existingSessionId } = body;

    if (!blobUrl || !filename) {
      return NextResponse.json(
        { error: "Missing blobUrl or filename" },
        { status: 400 },
      );
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const sessionId =
      existingSessionId ||
      `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    if (!existingSessionId) {
      await createSession(sessionId);
    }
    await addDocument(sessionId, filename);

    await updateJobStatus(jobId, {
      status: "pending",
      progress: 0,
      message: "Job initialized",
    });

    processDocumentBackground(jobId, blobUrl, filename, sessionId).catch(
      (err) => {
        console.error("[DIRECT-UPLOAD] Background error:", err);
      },
    );

    return NextResponse.json({
      success: true,
      jobId,
      sessionId,
      message: "Processing started in background",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start processing", details: String(error) },
      { status: 500 },
    );
  }
}

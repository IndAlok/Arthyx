import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import { createSession, addDocument, updateJobStatus } from "@/lib/redis";

export const maxDuration = 300;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[DIRECT-UPLOAD][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

const BATCH_SIZE = 10;
const CHUNK_SIZE = 500;
const DELAY_BETWEEN_BATCHES = 10000;
const MAX_RETRIES = 5;

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
    start = end - 50;
    if (start >= text.length - 50) break;
  }
  return chunks;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = MAX_RETRIES
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = String(error).includes("429") || String(error).includes("Resource exhausted");
      if (attempt === retries) throw error;
      
      // Much more aggressive backoff for rate limits: 30s, 60s, 90s, 120s...
      const baseDelay = isRateLimit ? 30000 : 2000;
      const delay = baseDelay * attempt;
      
      log(`${operation} failed, retrying in ${delay}ms`, { attempt, error: String(error).substring(0, 100) });
      await sleep(delay);
    }
  }
  throw new Error(`${operation} failed after ${retries} retries`);
}

async function generateEmbedding(text: string, genAI: GoogleGenerativeAI): Promise<number[]> {
  return withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }, "Embedding");
}

async function extractBatchWithGemini(
  pdfDoc: PDFDocument, 
  startPage: number, 
  endPage: number,
  genAI: GoogleGenerativeAI
): Promise<string> {
  const pageCount = pdfDoc.getPageCount();
  const actualStart = Math.max(0, startPage);
  const actualEnd = Math.min(pageCount, endPage);
  
  const pagesToCopy = [];
  for (let i = actualStart; i < actualEnd; i++) {
    pagesToCopy.push(i);
  }
  
  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
  copiedPages.forEach((page) => newPdf.addPage(page));
  const batchPdfBytes = await newPdf.save();
  const base64Pdf = Buffer.from(batchPdfBytes).toString("base64");
  
  return withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Extract ALL text from this PDF (pages ${startPage + 1}-${actualEnd}). Mark each page as === PAGE X ===. Extract every word, number, table exactly. Tables: markdown | format. Do NOT summarize.`;
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    ]);
    return result.response.text();
  }, `Gemini extraction pages ${startPage + 1}-${actualEnd}`);
}

async function processDocumentBackground(jobId: string, blobUrl: string, filename: string, sessionId: string) {
  const startTime = Date.now();
  log(`Starting background job ${jobId}`);
  
  try {
    await updateJobStatus(jobId, { status: "processing", progress: 0, message: "Fetching PDF..." });

    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.status}`);
    const pdfBytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    log("PDF loaded", { pages: totalPages });
    await updateJobStatus(jobId, { progress: 5, message: `PDF loaded: ${totalPages} pages. Starting extraction...` });

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index("arthyx");

    let allText = "";
    let totalChunks = 0;
    const numBatches = Math.ceil(totalPages / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const startPage = batchIdx * BATCH_SIZE;
      const endPage = Math.min((batchIdx + 1) * BATCH_SIZE, totalPages);
      const progress = 5 + Math.floor(((batchIdx) / numBatches) * 90);
      
      await updateJobStatus(jobId, { 
        progress, 
        message: `Processing batch ${batchIdx + 1}/${numBatches} (Pages ${startPage + 1}-${endPage})...` 
      });
      
      try {
        const batchText = await extractBatchWithGemini(pdfDoc, startPage, endPage, genAI);
        allText += `\n\n=== BATCH ${batchIdx + 1}: PAGES ${startPage + 1}-${endPage} ===\n\n${batchText}`;
        const chunks = chunkText(batchText);
        
        for (let i = 0; i < chunks.length; i += 3) {
          const chunkBatch = chunks.slice(i, i + 3);
          try {
            const vectors = [];
            for (let j = 0; j < chunkBatch.length; j++) {
              const chunk = chunkBatch[j];
              const embedding = await generateEmbedding(chunk, genAI);
              vectors.push({
                id: `${sessionId}_b${batchIdx}_c${i + j}`,
                values: embedding,
                metadata: {
                  text: chunk.substring(0, 1000),
                  content: chunk.substring(0, 1000),
                  filename,
                  pageNumber: startPage + 1 + Math.floor((i + j) * (endPage - startPage) / chunks.length),
                  sessionId,
                  batchIndex: batchIdx,
                },
              });
              if (j < chunkBatch.length - 1) await sleep(200);
            }
            await index.upsert(vectors);
            totalChunks += vectors.length;
          } catch (chunkError) {
            log(`Chunk indexing error`, { error: String(chunkError) });
          }
        }
        
        if (batchIdx < numBatches - 1) {
          await sleep(DELAY_BETWEEN_BATCHES);
        }
      } catch (batchError) {
        log(`Batch ${batchIdx + 1} failed`, { error: String(batchError) });
      }
    }

    const duration = Date.now() - startTime;
    await updateJobStatus(jobId, { 
      status: "completed", 
      progress: 100, 
      message: "Processing complete!", 
      result: {
        sessionId,
        filename,
        pages: totalPages,
        chunks: totalChunks,
        textLength: allText.length,
        duration,
      }
    });
    log(`Job ${jobId} completed successfully`);

  } catch (error) {
    log(`Job ${jobId} failed`, { error: String(error) });
    await updateJobStatus(jobId, { 
      status: "failed", 
      error: String(error),
      message: "Processing failed. Please try again." 
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blobUrl, filename, sessionId: existingSessionId } = body;

    if (!blobUrl || !filename) {
      return NextResponse.json({ error: "Missing blobUrl or filename" }, { status: 400 });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const sessionId = existingSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    if (!existingSessionId) {
      await createSession(sessionId);
    }
    await addDocument(sessionId, filename);

    // Initialize job status
    await updateJobStatus(jobId, {
      status: "pending",
      progress: 0,
      message: "Job initialized"
    });

    // Start background processing WITHOUT awaiting
    processDocumentBackground(jobId, blobUrl, filename, sessionId).catch(err => {
      console.error("Background process fatal error:", err);
    });

    return NextResponse.json({
      success: true,
      jobId,
      sessionId,
      message: "Processing started in background"
    });

  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start processing", details: String(error) },
      { status: 500 }
    );
  }
}

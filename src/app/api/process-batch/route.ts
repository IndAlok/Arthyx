import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { Redis } from "@upstash/redis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

export const maxDuration = 300;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[PROCESS-BATCH][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

function getRedisClient(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

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
    if (chunk.length > 50) {
      chunks.push(chunk);
    }
    
    start = end - CHUNK_OVERLAP;
    if (start >= text.length - 50) break;
  }
  
  return chunks;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  log("=== BATCH REQUEST RECEIVED ===");
  
  try {
    const body = await request.json();
    const { jobId, blobUrl, filename, sessionId, batchIndex, startPage, endPage, totalPages } = body;

    log("Batch details", { jobId, batchIndex, startPage, endPage, totalPages, filename });

    const redis = getRedisClient();

    log("Fetching document from blob");
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.status}`);

    const pdfBytes = await response.arrayBuffer();
    log("Document fetched", { size: pdfBytes.byteLength });

    log("Extracting batch pages with pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    
    const actualStartPage = Math.max(0, startPage - 1);
    const actualEndPage = Math.min(pageCount, endPage);
    const pagesToCopy = [];
    for (let i = actualStartPage; i < actualEndPage; i++) {
      pagesToCopy.push(i);
    }
    
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));
    const batchPdfBytes = await newPdf.save();
    const base64Pdf = Buffer.from(batchPdfBytes).toString("base64");
    
    log("Batch PDF extracted", { 
      batchSize: batchPdfBytes.byteLength,
      pagesExtracted: pagesToCopy.length,
      compression: `${Math.round((1 - batchPdfBytes.byteLength / pdfBytes.byteLength) * 100)}% smaller`
    });

    log("=== GEMINI VISION EXTRACTION ===");
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Extract ALL text from this PDF batch (pages ${startPage}-${endPage} of ${totalPages}).

REQUIREMENTS:
1. Mark each page: === PAGE X ===
2. Extract EVERY word, number, symbol exactly
3. Tables: markdown | format with all data
4. Financial data: exact ₹ amounts, %, ratios
5. Hindi text: proper Unicode
6. Do NOT summarize - complete verbatim extraction

Extract now:`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    ]);

    const extractedText = result.response.text();
    log("Gemini extraction complete", { textLength: extractedText.length });

    log("=== CHUNKING AND INDEXING ===");
    const chunks = chunkText(extractedText);
    log("Chunks created", { count: chunks.length });

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index("financial-docs");

    const batchSize = 5;
    let indexed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await Promise.all(batch.map(async (chunk, idx) => {
        const embedding = await generateEmbedding(chunk);
        return {
          id: `${sessionId}_${batchIndex}_chunk_${i + idx}`,
          values: embedding,
          metadata: {
            text: chunk.substring(0, 1000),
            filename,
            pageNumber: startPage + Math.floor((i + idx) * (endPage - startPage) / chunks.length),
            sessionId,
            batchIndex,
          },
        };
      }));
      
      await index.upsert(vectors);
      indexed += vectors.length;
    }

    log("Vectors indexed", { count: indexed });

    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    await redis.hset(`job:${jobId}`, { extractedText: existingText + sectionMarker + extractedText });

    const completed = await redis.hincrby(`job:${jobId}`, "completedBatches", 1);
    const totalBatches = parseInt((await redis.hget(`job:${jobId}`, "totalBatches") as string) || "1", 10);
    
    log("Progress updated", { completed, totalBatches });

    if (completed >= totalBatches) {
      await redis.hset(`job:${jobId}`, { status: "complete" });
      log("JOB MARKED COMPLETE");
    }

    log("=== BATCH COMPLETE ===", { duration: Date.now() - startTime, chunks: chunks.length });

    return NextResponse.json({ 
      success: true, 
      batchIndex,
      textLength: extractedText.length,
      chunks: chunks.length,
      completed,
      totalBatches,
      duration: Date.now() - startTime
    });

  } catch (error) {
    log("BATCH ERROR", { error: String(error), stack: (error as Error).stack?.substring(0, 500) });
    
    try {
      const redis = getRedisClient();
      const body = await request.clone().json();
      if (body.jobId) {
        await redis.hincrby(`job:${body.jobId}`, "failedBatches", 1);
        const completed = await redis.hincrby(`job:${body.jobId}`, "completedBatches", 1);
        const totalBatches = parseInt((await redis.hget(`job:${body.jobId}`, "totalBatches") as string) || "1", 10);
        if (completed >= totalBatches) {
          await redis.hset(`job:${body.jobId}`, { status: "complete" });
        }
      }
    } catch (e) {
      log("Redis cleanup failed", { error: String(e) });
    }

    return NextResponse.json({ error: String(error), success: false }, { status: 200 });
  }
}

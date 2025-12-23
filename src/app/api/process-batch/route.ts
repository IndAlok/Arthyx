import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { Redis } from "@upstash/redis";
import { extractTextWithVision } from "@/lib/cloud-vision";
import { indexDocumentWithLlamaIndex } from "@/lib/llamaindex-rag";

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

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  log("=== BATCH REQUEST RECEIVED ===");
  
  try {
    const body = await request.json();
    const { jobId, blobUrl, filename, sessionId, batchIndex, startPage, endPage, totalPages } = body;

    log("Batch details", { 
      jobId, 
      batchIndex, 
      startPage, 
      endPage, 
      totalPages,
      filename
    });

    const redis = getRedisClient();

    log("Fetching full document from blob");
    const fetchStart = Date.now();
    const response = await fetch(blobUrl);
    
    if (!response.ok) {
      log("Blob fetch FAILED", { status: response.status });
      throw new Error(`Blob fetch failed: ${response.status}`);
    }

    const pdfBytes = await response.arrayBuffer();
    log("Full document fetched", { size: pdfBytes.byteLength, fetchTime: Date.now() - fetchStart });

    log("Extracting batch pages with pdf-lib", { startPage, endPage });
    const extractStart = Date.now();
    
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
    const batchBuffer = Buffer.from(batchPdfBytes);
    
    log("Batch PDF extracted", { 
      originalSize: pdfBytes.byteLength,
      batchSize: batchPdfBytes.byteLength,
      pagesExtracted: pagesToCopy.length,
      extractTime: Date.now() - extractStart,
      compression: `${Math.round((1 - batchPdfBytes.byteLength / pdfBytes.byteLength) * 100)}% smaller`
    });

    log("=== CLOUD VISION OCR ===");
    const visionStart = Date.now();
    
    const visionResult = await extractTextWithVision(batchBuffer, {
      extractTables: true,
    });
    
    log("Vision extraction complete", {
      pages: visionResult.pages.length,
      tables: visionResult.tables.length,
      textLength: visionResult.fullText.length,
      languages: visionResult.languages,
      confidence: visionResult.confidence.toFixed(2),
      visionTime: Date.now() - visionStart,
    });

    log("=== LLAMAINDEX INDEXING ===");
    const indexStart = Date.now();
    
    const indexResult = await indexDocumentWithLlamaIndex(
      visionResult,
      filename,
      sessionId
    );
    
    log("LlamaIndex indexing complete", {
      documentCount: indexResult.documentCount,
      chunkCount: indexResult.chunkCount,
      indexTime: Date.now() - indexStart,
    });

    const extractedText = visionResult.fullText;
    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    const newText = existingText + sectionMarker + extractedText;
    
    await redis.hset(`job:${jobId}`, { 
      extractedText: newText,
      tables: JSON.stringify(visionResult.tables),
      languages: visionResult.languages.join(","),
    });
    
    log("Text appended to job", { 
      previousLength: existingText.length, 
      addedLength: extractedText.length,
      totalLength: newText.length,
      tablesFound: visionResult.tables.length,
    });

    const completed = await redis.hincrby(`job:${jobId}`, "completedBatches", 1);
    const totalBatches = parseInt((await redis.hget(`job:${jobId}`, "totalBatches") as string) || "1", 10);
    
    log("Progress updated", { completed, totalBatches, isComplete: completed >= totalBatches });

    if (completed >= totalBatches) {
      await redis.hset(`job:${jobId}`, { status: "complete" });
      log("JOB MARKED COMPLETE", { jobId });
    }

    const totalDuration = Date.now() - startTime;
    log("=== BATCH COMPLETE ===", { 
      batchIndex,
      duration: totalDuration,
      textLength: extractedText.length,
      pagesProcessed: pagesToCopy.length,
      chunksIndexed: indexResult.chunkCount,
    });

    return NextResponse.json({ 
      success: true, 
      batchIndex,
      textLength: extractedText.length,
      tables: visionResult.tables.length,
      chunks: indexResult.chunkCount,
      completed,
      totalBatches,
      pagesProcessed: pagesToCopy.length,
      duration: totalDuration
    });

  } catch (error) {
    log("BATCH ERROR", { error: String(error), duration: Date.now() - startTime });
    
    try {
      const redis = getRedisClient();
      const body = await request.clone().json();
      
      if (body.jobId) {
        await redis.hincrby(`job:${body.jobId}`, "failedBatches", 1);
        const completed = await redis.hincrby(`job:${body.jobId}`, "completedBatches", 1);
        const totalBatches = parseInt((await redis.hget(`job:${body.jobId}`, "totalBatches") as string) || "1", 10);
        
        log("Error recorded", { completed, totalBatches });
        
        if (completed >= totalBatches) {
          await redis.hset(`job:${body.jobId}`, { status: "complete" });
          log("JOB COMPLETE (with errors)", { jobId: body.jobId });
        }
      }
    } catch (redisError) {
      log("Redis error recording failed", { error: String(redisError) });
    }

    return NextResponse.json({ error: String(error), success: false }, { status: 200 });
  }
}

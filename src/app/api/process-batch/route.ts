import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { Redis } from "@upstash/redis";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
    const base64Pdf = Buffer.from(batchPdfBytes).toString("base64");
    
    log("Batch PDF extracted", { 
      originalSize: pdfBytes.byteLength,
      batchSize: batchPdfBytes.byteLength,
      base64Length: base64Pdf.length,
      pagesExtracted: pagesToCopy.length,
      extractTime: Date.now() - extractStart,
      compression: `${Math.round((1 - batchPdfBytes.byteLength / pdfBytes.byteLength) * 100)}% smaller`
    });

    log("Calling Gemini Vision on batch PDF");
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Extract ALL text from this PDF batch (pages ${startPage}-${endPage} of ${totalPages}).

REQUIREMENTS:
1. Mark each page: === PAGE X ===
2. Extract EVERY word, number, symbol exactly
3. Tables: markdown | format with all data
4. Financial data: exact ₹ amounts, %, ratios (NPA, CAR, ROA, ROE)
5. Hindi text: proper Unicode
6. Charts/images: describe key data points
7. Do NOT summarize - complete verbatim extraction

Extract pages ${startPage}-${endPage}:`;

    const aiStart = Date.now();
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    ]);

    const extractedText = result.response.text();
    
    log("Gemini extraction complete", { 
      batchIndex,
      textLength: extractedText.length,
      aiDuration: Date.now() - aiStart,
      pages: `${startPage}-${endPage}`
    });

    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    const newText = existingText + sectionMarker + extractedText;
    
    await redis.hset(`job:${jobId}`, { extractedText: newText });
    log("Text appended to job", { 
      previousLength: existingText.length, 
      addedLength: extractedText.length,
      totalLength: newText.length
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
      pagesProcessed: pagesToCopy.length
    });

    return NextResponse.json({ 
      success: true, 
      batchIndex,
      textLength: extractedText.length,
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

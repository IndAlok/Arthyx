import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

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

    log("Fetching document from blob");
    const fetchStart = Date.now();
    const response = await fetch(blobUrl);
    
    if (!response.ok) {
      log("Blob fetch FAILED", { status: response.status });
      throw new Error(`Blob fetch failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    log("Document fetched", { size: buffer.length, fetchTime: Date.now() - fetchStart });

    const base64Data = buffer.toString("base64");

    log("Calling Gemini Vision", { base64Length: base64Data.length });
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `Extract ALL text from pages ${startPage}-${endPage} of this ${totalPages}-page document.

REQUIREMENTS:
1. Mark each page: === PAGE X ===
2. Extract EVERY word, number, symbol exactly
3. Tables: markdown | format
4. Financial: exact ₹ amounts, %, ratios
5. Hindi: proper Unicode
6. Do NOT summarize - complete verbatim text

Extract pages ${startPage}-${endPage}:`;

    const aiStart = Date.now();
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Data } },
    ]);

    const extractedText = result.response.text();
    log("Gemini complete", { 
      batchIndex,
      textLength: extractedText.length,
      aiDuration: Date.now() - aiStart
    });

    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    const newText = existingText + sectionMarker + extractedText;
    
    await redis.hset(`job:${jobId}`, { extractedText: newText });
    log("Text appended", { 
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

    log("=== BATCH COMPLETE ===", { 
      batchIndex,
      duration: Date.now() - startTime,
      textLength: extractedText.length
    });

    return NextResponse.json({ 
      success: true, 
      batchIndex,
      textLength: extractedText.length,
      completed,
      totalBatches
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

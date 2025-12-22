import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[PROCESS-BATCH][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

function getRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return new Redis({ url: url!, token: token! });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  log("=== BATCH PROCESSING REQUEST RECEIVED ===");
  
  try {
    const body = await request.json();
    const { jobId, blobUrl, filename, sessionId, batchIndex, startPage, endPage, totalPages } = body;

    log("Request parsed", { 
      jobId, 
      batchIndex, 
      startPage, 
      endPage, 
      totalPages,
      filename,
      blobUrl: blobUrl?.substring(0, 50)
    });

    const redis = getRedisClient();

    log("Fetching file from blob storage");
    const fetchStart = Date.now();
    const response = await fetch(blobUrl);
    
    if (!response.ok) {
      log("Blob fetch FAILED", { status: response.status });
      throw new Error(`Failed to fetch file: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    log("File fetched", { 
      size: buffer.length, 
      fetchTime: Date.now() - fetchStart 
    });

    const base64Data = buffer.toString("base64");
    log("Base64 encoded", { base64Length: base64Data.length });

    log("Initializing Gemini");
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `You are a document extraction expert analyzing pages ${startPage}-${endPage} of a ${totalPages}-page document.

EXTRACTION REQUIREMENTS:

1. PAGE MARKERS: Start each page with === PAGE X ===

2. TEXT EXTRACTION: Extract EVERY word, number, symbol exactly as printed

3. TABLE EXTRACTION: Use markdown table format: | Header | Data |

4. FINANCIAL DATA - EXACT:
   - Monetary: ₹ amounts, crores, lakhs
   - Ratios: NPA%, CAR%, NIM%, ROA%, ROE%
   - Growth: YoY%, QoQ%

5. SCANNED CONTENT: OCR all text from scanned pages

OUTPUT: Extract COMPLETE text for pages ${startPage}-${endPage}. Do NOT summarize.`;

    log("Calling Gemini Vision API", { 
      promptLength: prompt.length, 
      pages: `${startPage}-${endPage}`
    });
    
    const aiStart = Date.now();

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Data } },
    ]);

    const extractedText = result.response.text();
    const aiDuration = Date.now() - aiStart;
    
    log("Gemini extraction complete", { 
      batchIndex,
      textLength: extractedText.length,
      aiDuration,
      pages: `${startPage}-${endPage}`
    });

    log("Updating Redis with extracted text");
    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    const newText = existingText + sectionMarker + extractedText;
    
    await redis.hset(`job:${jobId}`, { extractedText: newText });
    log("Text appended to job", { 
      previousLength: existingText.length, 
      addedLength: extractedText.length,
      newTotalLength: newText.length
    });

    const completed = await redis.hincrby(`job:${jobId}`, "completedBatches", 1);
    const totalBatches = parseInt((await redis.hget(`job:${jobId}`, "totalBatches") as string) || "1", 10);
    
    log("Batch counter incremented", { 
      jobId, 
      completed, 
      totalBatches,
      isComplete: completed >= totalBatches
    });

    if (completed >= totalBatches) {
      await redis.hset(`job:${jobId}`, { status: "complete" });
      log("JOB MARKED COMPLETE", { jobId, totalBatches: completed });
    }

    const totalDuration = Date.now() - startTime;
    log("=== BATCH PROCESSING COMPLETE ===", { 
      batchIndex,
      duration: totalDuration,
      textLength: extractedText.length
    });

    return NextResponse.json({ 
      success: true, 
      batchIndex,
      startPage,
      endPage,
      textLength: extractedText.length,
      duration: totalDuration
    });

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    log("BATCH PROCESSING ERROR", { 
      error: String(error),
      duration: totalDuration
    });
    
    try {
      const redis = getRedisClient();
      const body = await request.clone().json();
      
      if (body.jobId) {
        log("Recording failure in Redis", { jobId: body.jobId });
        
        const currentStatus = await redis.hget(`job:${body.jobId}`, "status");
        if (currentStatus !== "complete") {
          await redis.hincrby(`job:${body.jobId}`, "failedBatches", 1);
          await redis.hincrby(`job:${body.jobId}`, "completedBatches", 1);
          
          const completed = parseInt((await redis.hget(`job:${body.jobId}`, "completedBatches") as string) || "0", 10);
          const totalBatches = parseInt((await redis.hget(`job:${body.jobId}`, "totalBatches") as string) || "1", 10);
          
          log("Error recorded", { completed, totalBatches });
          
          if (completed >= totalBatches) {
            await redis.hset(`job:${body.jobId}`, { status: "complete" });
            log("JOB MARKED COMPLETE (with errors)", { jobId: body.jobId });
          }
        }
      }
    } catch (redisError) {
      log("Failed to record error in Redis", { redisError: String(redisError) });
    }

    return NextResponse.json({ 
      error: String(error), 
      success: false 
    });
  }
}

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { Redis } from "@upstash/redis";
import { GoogleGenerativeAI } from "@google/generative-ai";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  console.log(`[BATCH] ${step}`, data ? JSON.stringify(data) : "");
};

async function handler(request: Request) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { jobId, blobUrl, filename, batchIndex, startPage, endPage, totalPages } = body;

    log("Processing batch", { jobId, batchIndex, startPage, endPage, totalPages });

    const fetchStart = Date.now();
    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    log("File fetched", { size: buffer.length, fetchTime: Date.now() - fetchStart });

    const base64Data = buffer.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `You are a document extraction expert analyzing pages ${startPage}-${endPage} of a ${totalPages}-page document.

EXTRACTION REQUIREMENTS - FOLLOW EXACTLY:

1. PAGE MARKERS: Start each page with === PAGE X ===

2. TEXT EXTRACTION: 
   - Extract EVERY word, number, symbol exactly as written
   - Preserve paragraph structure
   - Keep original formatting where possible

3. TABLE EXTRACTION:
   - Use markdown table format: | Header1 | Header2 |
   - Include ALL rows and columns
   - Preserve numerical precision

4. FINANCIAL DATA - CRITICAL ACCURACY:
   - Monetary amounts: ₹ amounts, crores, lakhs (e.g., ₹45,678.90 crores)
   - Ratios: NPA%, CAR%, NIM%, ROA%, ROE% (e.g., GNPA: 4.52%)
   - Growth rates: YoY%, QoQ%
   - All numerical values with exact decimal places

5. SCANNED/IMAGE CONTENT:
   - OCR all text from scanned pages
   - Describe charts/graphs with their data values
   - Extract text from headers, footers, watermarks

6. MULTI-LANGUAGE:
   - Hindi text in Devanagari Unicode
   - Preserve original script for regional languages

7. REGULATORY REFERENCES:
   - SEBI, RBI, Basel norms mentions
   - Compliance statements
   - Audit observations

OUTPUT FORMAT:
=== PAGE ${startPage} ===
[Complete extracted text for page ${startPage}]

=== PAGE ${startPage + 1} ===
[Complete extracted text for page ${startPage + 1}]

... continue for all pages in range ...

Do NOT summarize. Extract COMPLETE verbatim text.`;

    log("Calling Gemini", { promptLength: prompt.length, base64Length: base64Data.length });
    const aiStart = Date.now();

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Data } },
    ]);

    const extractedText = result.response.text();
    
    log("Batch extracted", { 
      batchIndex, 
      textLength: extractedText.length,
      aiTime: Date.now() - aiStart,
      totalTime: Date.now() - startTime 
    });

    const existingText = await redis.hget(`job:${jobId}`, "extractedText") as string || "";
    const sectionMarker = `\n\n=== BATCH ${batchIndex + 1}: PAGES ${startPage}-${endPage} ===\n\n`;
    const newText = existingText + sectionMarker + extractedText;
    
    await redis.hset(`job:${jobId}`, { extractedText: newText });
    const completed = await redis.hincrby(`job:${jobId}`, "completedBatches", 1);
    
    const totalBatches = parseInt((await redis.hget(`job:${jobId}`, "totalBatches") as string) || "1", 10);
    
    log("Batch saved", { jobId, completed, totalBatches });

    if (completed >= totalBatches) {
      await redis.hset(`job:${jobId}`, { status: "complete" });
      log("Job complete", { jobId, totalBatches: completed });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      batchIndex,
      startPage,
      endPage,
      textLength: extractedText.length,
      duration: Date.now() - startTime
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    log("Batch error", { error: String(error), duration: Date.now() - startTime });
    
    try {
      const body = await request.clone().json();
      if (body.jobId) {
        const currentStatus = await redis.hget(`job:${body.jobId}`, "status");
        if (currentStatus !== "complete") {
          await redis.hincrby(`job:${body.jobId}`, "failedBatches", 1);
          await redis.hincrby(`job:${body.jobId}`, "completedBatches", 1);
          
          const completed = parseInt((await redis.hget(`job:${body.jobId}`, "completedBatches") as string) || "0", 10);
          const totalBatches = parseInt((await redis.hget(`job:${body.jobId}`, "totalBatches") as string) || "1", 10);
          
          if (completed >= totalBatches) {
            await redis.hset(`job:${body.jobId}`, { status: "complete" });
          }
        }
      }
    } catch { }

    return new Response(JSON.stringify({ error: String(error), success: false }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const POST = verifySignatureAppRouter(handler);

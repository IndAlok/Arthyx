import { Client } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

export const runtime = "edge";
export const maxDuration = 300;

const BATCH_SIZE = 50;
const MAX_BATCHES = 12;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[ASYNC-UPLOAD][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

function getQStashClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    log("ERROR: QSTASH_TOKEN not found in environment");
    return null;
  }
  log("QStash client initialized", { tokenLength: token.length });
  return new Client({ token });
}

function getRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  log("Redis client initializing", { hasUrl: !!url, hasToken: !!token });
  return new Redis({ url: url!, token: token! });
}

function getBaseUrl(): string {
  const vercelUrl = process.env.VERCEL_URL;
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  
  let baseUrl: string;
  if (vercelUrl) {
    baseUrl = `https://${vercelUrl}`;
  } else if (prodUrl) {
    baseUrl = `https://${prodUrl}`;
  } else {
    baseUrl = "http://localhost:3000";
  }
  
  log("Base URL determined", { baseUrl, vercelUrl, prodUrl });
  return baseUrl;
}

function estimatePageCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  let text = "";
  const checkLength = Math.min(bytes.length, 100000);
  for (let i = 0; i < checkLength; i++) {
    const byte = bytes[i];
    if (byte >= 32 && byte <= 126) {
      text += String.fromCharCode(byte);
    }
  }
  
  const pageRefs = text.match(/\/Type\s*\/Page[^s]/g);
  const countMatch = text.match(/\/Count\s+(\d+)/);
  
  let pages: number;
  if (countMatch) {
    pages = parseInt(countMatch[1], 10);
  } else if (pageRefs) {
    pages = Math.max(pageRefs.length, Math.ceil(buffer.byteLength / 12000));
  } else {
    pages = Math.max(1, Math.ceil(buffer.byteLength / 12000));
  }
  
  log("Page count estimated", { pages, fileSize: buffer.byteLength });
  return pages;
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const startTime = Date.now();
  
  log("=== ASYNC UPLOAD REQUEST STARTED ===");
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        const message = `data: ${JSON.stringify({ event, ...data, timestamp: Date.now() })}\n\n`;
        controller.enqueue(encoder.encode(message));
        log(`SSE Event: ${event}`, data);
      };

      try {
        const body = await request.json();
        const { blobUrl, filename, sessionId: existingSessionId } = body;
        
        log("Request body parsed", { blobUrl: blobUrl?.substring(0, 50), filename, existingSessionId });

        if (!blobUrl) {
          send("error", { message: "No blob URL provided" });
          controller.close();
          return;
        }

        const qstash = getQStashClient();
        const redis = getRedisClient();

        if (!qstash) {
          send("error", { message: "QStash not configured - check QSTASH_TOKEN" });
          controller.close();
          return;
        }

        let sessionId = existingSessionId;
        if (!sessionId) {
          sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          log("New session ID generated", { sessionId });
        }

        send("status", { message: "Fetching document...", progress: 5, sessionId });

        log("Fetching file from blob", { blobUrl: blobUrl.substring(0, 80) });
        const response = await fetch(blobUrl);
        if (!response.ok) {
          log("Blob fetch failed", { status: response.status });
          send("error", { message: `Failed to fetch file: ${response.status}` });
          controller.close();
          return;
        }

        const buffer = await response.arrayBuffer();
        const fileSize = buffer.byteLength;
        const estimatedPages = estimatePageCount(buffer);

        log("Document fetched and analyzed", { fileSize, estimatedPages });
        send("status", { message: `Document: ${estimatedPages} pages (~${(fileSize/1024/1024).toFixed(1)}MB)`, progress: 10, sessionId });

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const numBatches = Math.min(Math.ceil(estimatedPages / BATCH_SIZE), MAX_BATCHES);

        log("Creating job in Redis", { jobId, numBatches });
        
        await redis.hset(`job:${jobId}`, {
          sessionId,
          filename,
          blobUrl,
          totalBatches: numBatches,
          completedBatches: 0,
          failedBatches: 0,
          status: "processing",
          estimatedPages,
          createdAt: Date.now(),
          extractedText: "",
        });

        log("Job created in Redis", { jobId });
        send("status", { message: `Job created, queuing ${numBatches} batches...`, progress: 15, sessionId });

        const baseUrl = getBaseUrl();
        const batchJobs = [];

        for (let i = 0; i < numBatches; i++) {
          const startPage = i * BATCH_SIZE + 1;
          const endPage = Math.min((i + 1) * BATCH_SIZE, estimatedPages);
          batchJobs.push({
            jobId,
            blobUrl,
            filename,
            sessionId,
            batchIndex: i,
            startPage,
            endPage,
            totalPages: estimatedPages,
          });
        }

        log("Batch jobs prepared", { count: batchJobs.length });

        let successfulPublishes = 0;
        let failedPublishes = 0;
        
        for (let i = 0; i < batchJobs.length; i++) {
          const job = batchJobs[i];
          const targetUrl = `${baseUrl}/api/process-batch`;
          
          try {
            log(`Publishing QStash job ${i}`, { targetUrl, pages: `${job.startPage}-${job.endPage}` });
            
            const result = await qstash.publishJSON({
              url: targetUrl,
              body: job,
              retries: 2,
            });
            
            log(`QStash job ${i} published`, { messageId: result.messageId });
            successfulPublishes++;
          } catch (qstashError) {
            log(`QStash publish FAILED for job ${i}`, { error: String(qstashError) });
            failedPublishes++;
          }
        }

        log("QStash publishing complete", { successfulPublishes, failedPublishes, total: batchJobs.length });
        
        if (successfulPublishes === 0) {
          send("error", { message: "Failed to queue any jobs - check QStash configuration" });
          controller.close();
          return;
        }

        send("status", { message: `${successfulPublishes}/${numBatches} batches queued`, progress: 20, sessionId });

        let attempts = 0;
        const maxAttempts = 180;
        const pollInterval = 2000;
        let lastCompleted = 0;
        let lastLogTime = Date.now();

        log("Starting polling loop", { maxAttempts, pollInterval });

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          attempts++;

          try {
            const job = await redis.hgetall(`job:${jobId}`) as {
              completedBatches?: string;
              totalBatches?: string;
              failedBatches?: string;
              status?: string;
              error?: string;
              extractedText?: string;
            } | null;

            if (!job) {
              log("POLL ERROR: Job not found in Redis", { jobId, attempts });
              send("error", { message: "Job disappeared from queue" });
              break;
            }

            const completed = parseInt(job.completedBatches || "0", 10);
            const total = parseInt(job.totalBatches || "1", 10);
            const failed = parseInt(job.failedBatches || "0", 10);
            const textLen = (job.extractedText || "").length;
            const progress = Math.round(20 + (completed / total) * 60);

            if (completed !== lastCompleted || Date.now() - lastLogTime > 10000) {
              log("POLL STATUS", { 
                jobId, 
                completed, 
                total, 
                failed, 
                textLength: textLen,
                status: job.status,
                attempts 
              });
              lastCompleted = completed;
              lastLogTime = Date.now();
            }

            send("status", { 
              message: `Extracting: ${completed}/${total} batches${failed > 0 ? ` (${failed} errors)` : ""}`, 
              progress,
              sessionId,
              completed,
              total,
              failed,
              textLength: textLen
            });

            if (job.status === "complete") {
              log("JOB COMPLETE - Starting indexing", { textLength: textLen });
              send("status", { message: "Creating search index...", progress: 85, sessionId });
              
              const extractedText = job.extractedText || "";
              
              if (extractedText.length > 500) {
                try {
                  log("Calling /api/index", { textLength: extractedText.length });
                  
                  const indexResponse = await fetch(`${baseUrl}/api/index`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      extractedText,
                      filename,
                      pages: estimatedPages,
                      sessionId,
                    }),
                  });

                  if (indexResponse.ok) {
                    const indexData = await indexResponse.json();
                    log("Indexing successful", { chunks: indexData.chunks, sessionId: indexData.sessionId });
                    send("status", { message: `Indexed ${indexData.chunks} chunks`, progress: 95, sessionId });
                    send("file_complete", { filename, pages: estimatedPages, chunks: indexData.chunks });
                  } else {
                    const errorText = await indexResponse.text();
                    log("Indexing FAILED", { status: indexResponse.status, error: errorText });
                    send("status", { message: "Indexing failed - check logs", progress: 90, sessionId });
                  }
                } catch (indexError) {
                  log("Indexing ERROR", { error: String(indexError) });
                }
              } else {
                log("Insufficient text for indexing", { textLength: extractedText.length });
                send("status", { message: "Limited text extracted", progress: 85, sessionId });
              }

              send("complete", { sessionId, filename, pages: estimatedPages, duration: Date.now() - startTime });
              break;
            }

            if (job.status === "error") {
              log("JOB ERROR", { error: job.error });
              send("error", { message: job.error || "Processing failed" });
              break;
            }
          } catch (pollError) {
            log("POLL EXCEPTION", { error: String(pollError), attempts });
          }
        }

        if (attempts >= maxAttempts) {
          log("TIMEOUT: Max polling attempts reached", { attempts });
          send("error", { message: "Processing timeout - document may be too large" });
        }

        log("Cleaning up job from Redis", { jobId });
        await redis.del(`job:${jobId}`);
        
        log("=== ASYNC UPLOAD COMPLETE ===", { duration: Date.now() - startTime });
        controller.close();

      } catch (error) {
        log("FATAL ERROR", { error: String(error) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "error", message: String(error) })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

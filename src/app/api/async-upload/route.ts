import { Client } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const runtime = "edge";
export const maxDuration = 300;

const BATCH_SIZE = 50;
const MAX_BATCHES = 12;

const log = (step: string, data?: object) => {
  console.log(`[ASYNC-UPLOAD] ${step}`, data ? JSON.stringify(data) : "");
};

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
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
  
  if (countMatch) {
    return parseInt(countMatch[1], 10);
  }
  if (pageRefs) {
    return Math.max(pageRefs.length, Math.ceil(buffer.byteLength / 12000));
  }
  
  return Math.max(1, Math.ceil(buffer.byteLength / 12000));
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const startTime = Date.now();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        const message = `data: ${JSON.stringify({ event, ...data, timestamp: Date.now() })}\n\n`;
        controller.enqueue(encoder.encode(message));
        log(`Event: ${event}`, data);
      };

      try {
        const body = await request.json();
        const { blobUrl, filename, sessionId: existingSessionId } = body;

        if (!blobUrl) {
          send("error", { message: "No blob URL provided" });
          controller.close();
          return;
        }

        let sessionId = existingSessionId;
        if (!sessionId) {
          sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        send("status", { message: "Fetching document...", progress: 5, sessionId });

        const response = await fetch(blobUrl);
        if (!response.ok) {
          send("error", { message: `Failed to fetch file: ${response.status}` });
          controller.close();
          return;
        }

        const buffer = await response.arrayBuffer();
        const fileSize = buffer.byteLength;
        const estimatedPages = estimatePageCount(buffer);

        log("Document analyzed", { fileSize, estimatedPages });
        send("status", { message: `Document: ${estimatedPages} pages (~${(fileSize/1024/1024).toFixed(1)}MB)`, progress: 10, sessionId });

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const numBatches = Math.min(Math.ceil(estimatedPages / BATCH_SIZE), MAX_BATCHES);

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

        send("status", { message: `Queuing ${numBatches} parallel extraction jobs...`, progress: 15, sessionId });

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

        log("Publishing batch jobs", { count: batchJobs.length, baseUrl });

        for (const job of batchJobs) {
          await qstash.publishJSON({
            url: `${baseUrl}/api/process-batch`,
            body: job,
            retries: 2,
          });
        }

        send("status", { message: `${numBatches} extraction jobs queued`, progress: 20, sessionId });

        let attempts = 0;
        const maxAttempts = 150;
        const pollInterval = 2000;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          attempts++;

          const job = await redis.hgetall(`job:${jobId}`) as {
            completedBatches?: string;
            totalBatches?: string;
            failedBatches?: string;
            status?: string;
            error?: string;
          } | null;

          if (!job) {
            send("error", { message: "Job not found in queue" });
            break;
          }

          const completed = parseInt(job.completedBatches || "0", 10);
          const total = parseInt(job.totalBatches || "1", 10);
          const failed = parseInt(job.failedBatches || "0", 10);
          const progress = Math.round(20 + (completed / total) * 60);

          send("status", { 
            message: `Extracting: ${completed}/${total} batches (${failed} retried)`, 
            progress,
            sessionId,
            completed,
            total,
            failed
          });

          if (job.status === "complete") {
            send("status", { message: "Creating search index...", progress: 85, sessionId });
            
            const extractedText = await redis.hget(`job:${jobId}`, "extractedText") as string;
            
            log("Extraction complete", { textLength: extractedText?.length || 0 });

            if (extractedText && extractedText.length > 500) {
              try {
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
                  send("status", { message: `Indexed ${indexData.chunks} chunks`, progress: 95, sessionId });
                  send("file_complete", { filename, pages: estimatedPages, chunks: indexData.chunks });
                } else {
                  log("Index failed", { status: indexResponse.status });
                  send("status", { message: "Indexing partially complete", progress: 90, sessionId });
                }
              } catch (indexError) {
                log("Index error", { error: String(indexError) });
              }
            } else {
              send("status", { message: "Limited text extracted - file may be image-heavy", progress: 85, sessionId });
            }

            send("complete", { sessionId, filename, pages: estimatedPages, duration: Date.now() - startTime });
            break;
          }

          if (job.status === "error") {
            send("error", { message: job.error || "Processing failed" });
            break;
          }
        }

        if (attempts >= maxAttempts) {
          send("error", { message: "Processing timeout after 5 minutes" });
        }

        await redis.del(`job:${jobId}`);
        controller.close();

      } catch (error) {
        log("Stream error", { error: String(error) });
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

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

function getStableCallbackUrl(): string {
  // Render provides this automatically
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    log("Using RENDER URL for callbacks", { renderUrl });
    return `${renderUrl}/api/process-batch`;
  }
  
  // Vercel production URL
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelUrl) {
    log("Using VERCEL URL for callbacks", { vercelUrl });
    return `https://${vercelUrl}/api/process-batch`;
  }
  
  // Development
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000/api/process-batch";
  }
  
  // Fallback: Use the app's own URL
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return `${appUrl}/api/process-batch`;
  }
  
  throw new Error("No callback URL configured - set RENDER_EXTERNAL_URL, VERCEL_PROJECT_PRODUCTION_URL, or APP_URL");
}

function getRedisClient(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

function getQStashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN not configured");
  }
  return new Client({ token });
}

function estimatePageCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  let text = "";
  const checkLength = Math.min(bytes.length, 100000);
  for (let i = 0; i < checkLength; i++) {
    if (bytes[i] >= 32 && bytes[i] <= 126) {
      text += String.fromCharCode(bytes[i]);
    }
  }
  
  const countMatch = text.match(/\/Count\s+(\d+)/);
  if (countMatch) return parseInt(countMatch[1], 10);
  
  const pageRefs = text.match(/\/Type\s*\/Page[^s]/g);
  if (pageRefs) return Math.max(pageRefs.length, Math.ceil(buffer.byteLength / 12000));
  
  return Math.max(1, Math.ceil(buffer.byteLength / 12000));
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const startTime = Date.now();
  
  log("=== ASYNC UPLOAD STARTED ===");
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        try {
          const message = `data: ${JSON.stringify({ event, ...data, timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(message));
          log(`SSE: ${event}`, data);
        } catch (e) {
          log("SSE error", { error: String(e) });
        }
      };

      let sessionId = "";
      let filename = "";

      try {
        const body = await request.json();
        const { blobUrl, sessionId: existingSessionId } = body;
        filename = body.filename;
        
        log("Request received", { filename, blobUrl: blobUrl?.substring(0, 50), existingSessionId });

        if (!blobUrl) {
          send("error", { message: "No blob URL provided" });
          controller.close();
          return;
        }

        const qstash = getQStashClient();
        const redis = getRedisClient();
        const callbackUrl = getStableCallbackUrl();

        sessionId = existingSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        log("SessionId", { sessionId, isNew: !existingSessionId });

        send("status", { message: "Creating session...", progress: 3, sessionId });

        const { createSession, addDocument, getSession } = await import("@/lib/redis");
        
        const existingSession = await getSession(sessionId);
        if (!existingSession) {
          await createSession(sessionId);
          log("Session created", { sessionId });
        }
        
        await addDocument(sessionId, filename);
        log("Document registered IMMEDIATELY", { sessionId, filename });

        send("status", { message: "Fetching document...", progress: 5, sessionId });

        const response = await fetch(blobUrl);
        if (!response.ok) {
          send("error", { message: `Blob fetch failed: ${response.status}` });
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

        log("Job created in Redis", { jobId, numBatches });
        send("status", { message: `Queuing ${numBatches} batches...`, progress: 15, sessionId });

        let successfulPublishes = 0;
        
        for (let i = 0; i < numBatches; i++) {
          const startPage = i * BATCH_SIZE + 1;
          const endPage = Math.min((i + 1) * BATCH_SIZE, estimatedPages);
          
          const batchPayload = {
            jobId,
            blobUrl,
            filename,
            sessionId,
            batchIndex: i,
            startPage,
            endPage,
            totalPages: estimatedPages,
          };

          try {
            const result = await qstash.publishJSON({
              url: callbackUrl,
              body: batchPayload,
              retries: 3,
              headers: {
                "Upstash-Deduplication-Id": `${sessionId}-batch-${i}`,
              },
            });
            
            log(`QStash batch ${i} published`, { messageId: result.messageId, pages: `${startPage}-${endPage}` });
            successfulPublishes++;
          } catch (qstashError) {
            log(`QStash batch ${i} FAILED`, { error: String(qstashError) });
          }
        }

        log("QStash publishing complete", { successful: successfulPublishes, total: numBatches });
        
        if (successfulPublishes === 0) {
          send("error", { message: "Failed to queue any batches - check QStash config" });
          controller.close();
          return;
        }

        send("status", { message: `${successfulPublishes}/${numBatches} batches queued`, progress: 20, sessionId });

        let attempts = 0;
        const maxAttempts = 150;
        const pollInterval = 2000;
        let lastCompleted = -1;

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
              extractedText?: string;
            } | null;

            if (!job) {
              log("Job not found", { jobId, attempts });
              break;
            }

            const completed = parseInt(job.completedBatches || "0", 10);
            const total = parseInt(job.totalBatches || "1", 10);
            const failed = parseInt(job.failedBatches || "0", 10);
            const textLen = (job.extractedText || "").length;
            const progress = Math.round(20 + (completed / total) * 60);

            if (completed !== lastCompleted) {
              log("Progress update", { jobId, completed, total, failed, textLen, attempts });
              lastCompleted = completed;
            }

            send("status", { 
              message: `Extracting: ${completed}/${total} batches${failed > 0 ? ` (${failed} errors)` : ""}`, 
              progress,
              sessionId,
              completed,
              total,
              textLength: textLen
            });

            if (job.status === "complete") {
              log("Job complete, starting indexing", { textLen });
              send("status", { message: "Creating search index...", progress: 85, sessionId });
              
              const extractedText = job.extractedText || "";
              
              if (extractedText.length > 500) {
                try {
                  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || "localhost:3000";
                  const protocol = prodUrl.includes("localhost") ? "http" : "https";
                  
                  const indexResponse = await fetch(`${protocol}://${prodUrl}/api/index`, {
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
                    log("Indexing successful", indexData);
                    send("status", { message: `Indexed ${indexData.chunks} chunks`, progress: 95, sessionId });
                  } else {
                    log("Indexing failed", { status: indexResponse.status });
                  }
                } catch (indexError) {
                  log("Indexing error", { error: String(indexError) });
                }
              }

              send("file_complete", { filename, pages: estimatedPages });
              send("complete", { sessionId, filename, pages: estimatedPages, duration: Date.now() - startTime });
              break;
            }

            if (job.status === "error") {
              send("error", { message: "Processing failed" });
              break;
            }
          } catch (pollError) {
            log("Poll error", { error: String(pollError), attempts });
          }
        }

        if (attempts >= maxAttempts) {
          log("Timeout reached", { attempts });
          send("error", { message: "Processing timeout" });
        }

        await redis.del(`job:${jobId}`);
        log("=== ASYNC UPLOAD COMPLETE ===", { duration: Date.now() - startTime });
        controller.close();

      } catch (error) {
        log("FATAL ERROR", { error: String(error) });
        send("error", { message: String(error), sessionId });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

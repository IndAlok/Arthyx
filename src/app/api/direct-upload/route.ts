import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[DIRECT-UPLOAD][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

interface UploadRequest {
  blobUrl: string;
  filename: string;
  sessionId?: string;
}

function semanticChunk(text: string, chunkSize: number = 500, overlapPercent: number = 15): string[] {
  const overlap = Math.floor(chunkSize * (overlapPercent / 100));
  const chunks: string[] = [];
  
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    const cleanPara = para.trim();
    if (!cleanPara) continue;
    
    if (currentChunk.length + cleanPara.length > chunkSize && currentChunk.length > 100) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + " " + cleanPara;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + cleanPara;
    }
  }
  
  if (currentChunk.trim().length > 50) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

function createDocumentChunks(text: string, filename: string, sessionId: string): DocumentChunk[] {
  const pagePattern = /===\s*(?:PAGE|BATCH|SECTION)[:\s]*(\d+)(?:[^\n]*)?===/gi;
  const chunks: DocumentChunk[] = [];
  
  const pages: Array<{ pageNumber: number; content: string }> = [];
  let lastIndex = 0;
  let currentPageNum = 1;
  let match;
  
  while ((match = pagePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const content = text.substring(lastIndex, match.index).trim();
      if (content.length > 100) {
        pages.push({ pageNumber: currentPageNum, content });
      }
    }
    currentPageNum = parseInt(match[1], 10);
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    const content = text.substring(lastIndex).trim();
    if (content.length > 100) {
      pages.push({ pageNumber: currentPageNum, content });
    }
  }
  
  if (pages.length === 0 && text.length > 100) {
    pages.push({ pageNumber: 1, content: text });
  }

  for (const page of pages) {
    if (chunks.length >= 100) break;
    
    const semanticChunks = semanticChunk(page.content, 500, 15);
    
    for (const chunkText of semanticChunks) {
      if (chunks.length >= 100) break;
      if (chunkText.length < 50) continue;
      
      chunks.push({
        id: `${sessionId}_${filename.replace(/[^a-zA-Z0-9]/g, "_")}_${chunks.length}`,
        content: chunkText,
        metadata: {
          filename,
          pageNumber: page.pageNumber,
        },
      });
    }
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const startTime = Date.now();

  log("=== DIRECT UPLOAD STARTED ===");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        const message = `data: ${JSON.stringify({ event, ...data, timestamp: Date.now() })}\n\n`;
        controller.enqueue(encoder.encode(message));
        log(`SSE: ${event}`, data);
      };

      try {
        const body: UploadRequest = await request.json();
        const { blobUrl, filename, sessionId: existingSessionId } = body;

        log("Request received", { filename, blobUrl: blobUrl?.substring(0, 50) });

        if (!blobUrl) {
          send("error", { message: "No blob URL provided" });
          controller.close();
          return;
        }

        let sessionId = existingSessionId;
        if (!sessionId) {
          sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          log("New sessionId generated", { sessionId });
        }

        send("status", { message: "Fetching document...", progress: 5, sessionId });

        const response = await fetch(blobUrl);
        if (!response.ok) {
          log("Blob fetch failed", { status: response.status });
          send("error", { message: `Failed to fetch file: ${response.status}` });
          controller.close();
          return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const fileSize = buffer.length;
        
        log("Document fetched", { fileSize });
        send("status", { message: `Document: ${(fileSize/1024/1024).toFixed(1)}MB`, progress: 10, sessionId });

        const maxSize = 20 * 1024 * 1024;
        const useBuffer = buffer.length > maxSize ? buffer.subarray(0, maxSize) : buffer;
        const base64Data = useBuffer.toString("base64");

        send("status", { message: "Extracting text with Gemini Vision...", progress: 20, sessionId });

        log("Initializing Gemini", { base64Length: base64Data.length });
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        const prompt = `You are a document extraction expert. Extract ALL text from this PDF with COMPLETE ACCURACY.

CRITICAL REQUIREMENTS:
1. Extract EVERY word, number, and symbol exactly as written
2. Mark each page with: === PAGE X ===
3. For tables, use markdown format with | separators
4. For financial data: capture exact amounts, percentages, ratios (NPA%, CAR%, ROA%, ROE%)
5. For Hindi/regional text: use proper Unicode
6. Do NOT summarize - extract COMPLETE verbatim text

FINANCIAL DATA - EXACT PRECISION REQUIRED:
- Monetary amounts (₹, crores, lakhs, millions)
- Ratios and percentages (GNPA, NNPA, CAR, NIM, ROA, ROE)
- Growth rates (YoY, QoQ, CAGR)
- All numerical values with exact decimal places

Extract the complete document content:`;

        log("Calling Gemini Vision API");
        const aiStart = Date.now();

        send("status", { message: "Processing with Gemini Vision...", progress: 30, sessionId });

        const result = await model.generateContent([
          prompt,
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
        ]);

        const extractedText = result.response.text();
        const aiDuration = Date.now() - aiStart;

        log("Gemini extraction complete", { textLength: extractedText.length, aiDuration });
        send("status", { message: `Extracted ${extractedText.length.toLocaleString()} characters`, progress: 60, sessionId });

        if (extractedText.length < 200) {
          log("Insufficient text extracted", { length: extractedText.length });
          send("error", { message: "Could not extract meaningful text from document" });
          controller.close();
          return;
        }

        send("status", { message: "Creating session...", progress: 65, sessionId });

        const existingSession = await getSession(sessionId);
        if (!existingSession) {
          await createSession(sessionId);
          log("Session created", { sessionId });
        }

        send("status", { message: "Building semantic chunks...", progress: 70, sessionId });

        const documentChunks = createDocumentChunks(extractedText, filename, sessionId);
        log("Chunks created", { count: documentChunks.length });

        if (documentChunks.length > 0) {
          send("status", { message: `Embedding ${documentChunks.length} chunks...`, progress: 75, sessionId });

          const batchSize = 10;
          const allEmbeddings: number[][] = [];

          for (let i = 0; i < documentChunks.length; i += batchSize) {
            const batch = documentChunks.slice(i, i + batchSize);
            const embeddings = await generateEmbeddings(batch.map((c) => c.content));
            allEmbeddings.push(...embeddings);
            
            const progress = 75 + Math.round((i / documentChunks.length) * 15);
            send("status", { message: `Embedding: ${Math.min(i + batchSize, documentChunks.length)}/${documentChunks.length}`, progress, sessionId });
          }

          send("status", { message: "Indexing to vector database...", progress: 92, sessionId });
          await upsertDocumentChunks(documentChunks, allEmbeddings, sessionId);
          log("Chunks indexed to Pinecone", { count: documentChunks.length });
        }

        send("status", { message: "Finalizing...", progress: 95, sessionId });
        await addDocument(sessionId, filename);
        log("Document registered", { sessionId, filename });

        const duration = Date.now() - startTime;
        log("=== DIRECT UPLOAD COMPLETE ===", { sessionId, duration, chunks: documentChunks.length });

        send("file_complete", { filename, chunks: documentChunks.length });
        send("complete", { sessionId, filename, duration, chunks: documentChunks.length });

        controller.close();

      } catch (error) {
        log("=== DIRECT UPLOAD ERROR ===", { error: String(error) });
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
    },
  });
}

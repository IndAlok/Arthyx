import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import { createSession, addDocument } from "@/lib/redis";

export const maxDuration = 300;

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[DIRECT-UPLOAD][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

const BATCH_SIZE = 25; // Smaller batches
const CHUNK_SIZE = 500;
const DELAY_BETWEEN_BATCHES = 5000; // 5 second delay to avoid rate limits
const MAX_RETRIES = 3;

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
    start = end - 50;
    if (start >= text.length - 50) break;
  }
  return chunks;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = MAX_RETRIES
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = String(error).includes("429") || String(error).includes("Resource exhausted");
      
      if (attempt === retries) {
        throw error;
      }
      
      const delay = isRateLimit ? 10000 * attempt : 2000 * attempt;
      log(`${operation} failed, retrying in ${delay}ms`, { attempt, error: String(error).substring(0, 100) });
      await sleep(delay);
    }
  }
  throw new Error(`${operation} failed after ${retries} retries`);
}

async function generateEmbedding(text: string, genAI: GoogleGenerativeAI): Promise<number[]> {
  return withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }, "Embedding");
}

async function extractBatchWithGemini(
  pdfDoc: PDFDocument, 
  startPage: number, 
  endPage: number,
  genAI: GoogleGenerativeAI
): Promise<string> {
  const pageCount = pdfDoc.getPageCount();
  const actualStart = Math.max(0, startPage);
  const actualEnd = Math.min(pageCount, endPage);
  
  const pagesToCopy = [];
  for (let i = actualStart; i < actualEnd; i++) {
    pagesToCopy.push(i);
  }
  
  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
  copiedPages.forEach((page) => newPdf.addPage(page));
  const batchPdfBytes = await newPdf.save();
  const base64Pdf = Buffer.from(batchPdfBytes).toString("base64");
  
  return withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `Extract ALL text from this PDF (pages ${startPage + 1}-${actualEnd}).
Mark each page as === PAGE X ===
Extract every word, number, table exactly.
Tables: markdown | format.
Do NOT summarize.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    ]);

    return result.response.text();
  }, `Gemini extraction pages ${startPage + 1}-${actualEnd}`);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  log("=== DIRECT UPLOAD STARTED ===");
  
  try {
    const body = await request.json();
    const { blobUrl, filename, sessionId: existingSessionId } = body;

    if (!blobUrl || !filename) {
      return NextResponse.json({ error: "Missing blobUrl or filename" }, { status: 400 });
    }

    log("Request received", { filename, existingSessionId });

    const sessionId = existingSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    if (!existingSessionId) {
      await createSession(sessionId);
      log("Session created", { sessionId });
    }
    
    await addDocument(sessionId, filename);
    log("Document registered", { sessionId, filename });

    log("Fetching PDF from blob");
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.status}`);
    
    const pdfBytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    log("PDF loaded", { size: pdfBytes.byteLength, pages: totalPages });

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    
    // Use correct index name "arthyx"
    const index = pinecone.index("arthyx");

    let allText = "";
    let totalChunks = 0;
    let successfulBatches = 0;
    const numBatches = Math.ceil(totalPages / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const startPage = batchIdx * BATCH_SIZE;
      const endPage = Math.min((batchIdx + 1) * BATCH_SIZE, totalPages);
      
      log(`Processing batch ${batchIdx + 1}/${numBatches}`, { startPage: startPage + 1, endPage });
      
      try {
        const batchText = await extractBatchWithGemini(pdfDoc, startPage, endPage, genAI);
        allText += `\n\n=== BATCH ${batchIdx + 1}: PAGES ${startPage + 1}-${endPage} ===\n\n${batchText}`;
        
        log(`Batch ${batchIdx + 1} extracted`, { textLength: batchText.length });
        
        const chunks = chunkText(batchText);
        
        // Index chunks one at a time with delays
        for (let i = 0; i < chunks.length; i += 3) {
          const chunkBatch = chunks.slice(i, i + 3);
          
          try {
            const vectors = [];
            for (let j = 0; j < chunkBatch.length; j++) {
              const chunk = chunkBatch[j];
              const embedding = await generateEmbedding(chunk, genAI);
              vectors.push({
                id: `${sessionId}_b${batchIdx}_c${i + j}`,
                values: embedding,
                metadata: {
                  text: chunk.substring(0, 1000),
                  content: chunk.substring(0, 1000),
                  filename,
                  pageNumber: startPage + 1 + Math.floor((i + j) * (endPage - startPage) / chunks.length),
                  sessionId,
                  batchIndex: batchIdx,
                },
              });
              
              // Small delay between embeddings
              if (j < chunkBatch.length - 1) {
                await sleep(200);
              }
            }
            
            await index.upsert(vectors);
            totalChunks += vectors.length;
          } catch (chunkError) {
            log(`Chunk indexing error`, { error: String(chunkError).substring(0, 100) });
          }
        }
        
        successfulBatches++;
        log(`Batch ${batchIdx + 1} indexed`, { chunks: chunks.length, totalChunks });
        
        // Longer delay between batches
        if (batchIdx < numBatches - 1) {
          log(`Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch`);
          await sleep(DELAY_BETWEEN_BATCHES);
        }
        
      } catch (batchError) {
        log(`Batch ${batchIdx + 1} failed`, { error: String(batchError).substring(0, 200) });
        // Wait longer after an error
        await sleep(DELAY_BETWEEN_BATCHES * 2);
      }
    }

    const duration = Date.now() - startTime;
    log("=== PROCESSING COMPLETE ===", { 
      sessionId, 
      totalPages, 
      totalChunks,
      successfulBatches,
      totalBatches: numBatches,
      textLength: allText.length,
      duration 
    });

    return NextResponse.json({
      success: true,
      sessionId,
      filename,
      pages: totalPages,
      chunks: totalChunks,
      successfulBatches,
      totalBatches: numBatches,
      textLength: allText.length,
      duration,
    });

  } catch (error) {
    log("FATAL ERROR", { error: String(error), stack: (error as Error).stack?.substring(0, 500) });
    return NextResponse.json(
      { error: "Processing failed", details: String(error) },
      { status: 500 }
    );
  }
}

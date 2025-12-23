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

const BATCH_SIZE = 30; // Smaller batches for reliability
const CHUNK_SIZE = 500;

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

async function generateEmbedding(text: string, genAI: GoogleGenerativeAI): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
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
  
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  
  const prompt = `Extract ALL text from this PDF (pages ${startPage + 1}-${actualEnd}).
Mark each page as === PAGE X ===
Extract every word, number, table exactly as shown.
For tables, use markdown | format.
Do NOT summarize.`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
  ]);

  return result.response.text();
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

    log("Request received", { filename, blobUrl: blobUrl.substring(0, 50), existingSessionId });

    // Create session immediately
    const sessionId = existingSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    if (!existingSessionId) {
      await createSession(sessionId);
      log("Session created", { sessionId });
    }
    
    await addDocument(sessionId, filename);
    log("Document registered", { sessionId, filename });

    // Fetch the PDF
    log("Fetching PDF from blob");
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.status}`);
    
    const pdfBytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    log("PDF loaded", { size: pdfBytes.byteLength, pages: totalPages });

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index("financial-docs");

    let allText = "";
    let totalChunks = 0;
    const numBatches = Math.ceil(totalPages / BATCH_SIZE);

    // Process batches SEQUENTIALLY to avoid rate limits
    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const startPage = batchIdx * BATCH_SIZE;
      const endPage = Math.min((batchIdx + 1) * BATCH_SIZE, totalPages);
      
      log(`Processing batch ${batchIdx + 1}/${numBatches}`, { startPage: startPage + 1, endPage });
      
      try {
        // Extract text with Gemini Vision
        const batchText = await extractBatchWithGemini(pdfDoc, startPage, endPage, genAI);
        allText += `\n\n=== BATCH ${batchIdx + 1}: PAGES ${startPage + 1}-${endPage} ===\n\n${batchText}`;
        
        log(`Batch ${batchIdx + 1} extracted`, { textLength: batchText.length });
        
        // Chunk and embed
        const chunks = chunkText(batchText);
        
        // Index chunks in small batches
        for (let i = 0; i < chunks.length; i += 5) {
          const chunkBatch = chunks.slice(i, i + 5);
          const vectors = await Promise.all(chunkBatch.map(async (chunk, idx) => {
            const embedding = await generateEmbedding(chunk, genAI);
            return {
              id: `${sessionId}_batch${batchIdx}_chunk${i + idx}`,
              values: embedding,
              metadata: {
                text: chunk.substring(0, 1000),
                filename,
                pageNumber: startPage + 1 + Math.floor((i + idx) * (endPage - startPage) / chunks.length),
                sessionId,
                batchIndex: batchIdx,
              },
            };
          }));
          
          await index.upsert(vectors);
          totalChunks += vectors.length;
        }
        
        log(`Batch ${batchIdx + 1} indexed`, { chunks: chunks.length, totalChunks });
        
        // Small delay between batches to avoid rate limits
        if (batchIdx < numBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (batchError) {
        log(`Batch ${batchIdx + 1} error`, { error: String(batchError) });
        // Continue with other batches
      }
    }

    const duration = Date.now() - startTime;
    log("=== PROCESSING COMPLETE ===", { 
      sessionId, 
      totalPages, 
      totalChunks,
      textLength: allText.length,
      duration 
    });

    return NextResponse.json({
      success: true,
      sessionId,
      filename,
      pages: totalPages,
      chunks: totalChunks,
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

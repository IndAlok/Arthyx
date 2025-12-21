import { NextRequest } from "next/server";
import { processDocument, ProcessedDocument } from "@/lib/document-processor";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";
import { extractEntitiesFromText } from "@/lib/neo4j";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 50;

const log = (step: string, data?: object) => {
  console.log(`[UPLOAD] ${step}`, data ? JSON.stringify(data) : "");
};

const SUPPORTED_EXTENSIONS = [
  "pdf", "png", "jpg", "jpeg", "webp", "tiff",
  "doc", "docx", "xls", "xlsx", "csv",
  "txt", "md", "json", "xml", "html"
];

async function fetchFileFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = url.split("/").pop()?.split("?")[0] || "document";
  return { buffer, filename };
}

function createChunksFromText(text: string, pageCount: number): Array<{ content: string; pageNumber: number; chunkIndex: number; type: "text" | "table" | "header" }> {
  const chunks: Array<{ content: string; pageNumber: number; chunkIndex: number; type: "text" | "table" | "header" }> = [];
  const chunkSize = 800;
  const overlap = 100;
  
  const pagePattern = /===\s*PAGE\s*(\d+)\s*===/gi;
  const pages: Array<{ pageNumber: number; content: string }> = [];
  
  let lastIndex = 0;
  let currentPageNum = 1;
  let match;
  
  while ((match = pagePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const content = text.substring(lastIndex, match.index).trim();
      if (content.length > 50) {
        pages.push({ pageNumber: currentPageNum, content });
      }
    }
    currentPageNum = parseInt(match[1], 10);
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    const content = text.substring(lastIndex).trim();
    if (content.length > 50) {
      pages.push({ pageNumber: currentPageNum, content });
    }
  }
  
  if (pages.length === 0 && text.length > 50) {
    pages.push({ pageNumber: 1, content: text });
  }

  for (const page of pages) {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) break;
    
    const pageText = page.content;
    let pageChunks = 0;
    
    for (let i = 0; i < pageText.length && pageChunks < 3 && chunks.length < MAX_CHUNKS_PER_FILE; i += chunkSize - overlap) {
      const chunk = pageText.substring(i, i + chunkSize).trim();
      if (chunk.length > 50) {
        const isTable = chunk.includes("|") && chunk.includes("---");
        chunks.push({
          content: chunk,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length,
          type: isTable ? "table" : "text",
        });
        pageChunks++;
      }
    }
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`));
      };

      try {
        log("Upload started");
        send("status", { message: "Processing request...", progress: 5 });
        
        const body = await request.json();
        const { blobUrls, sessionId: existingSessionId, preExtractedText, pagesProcessed } = body;
        
        let sessionId = existingSessionId;

        if (!blobUrls || !Array.isArray(blobUrls) || blobUrls.length === 0) {
          send("error", { message: "No file URLs provided" });
          controller.close();
          return;
        }

        log("Blob URLs received", { count: blobUrls.length });

        if (!sessionId) {
          sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          await createSession(sessionId);
          log("Session created", { sessionId });
        } else {
          const existingSession = await getSession(sessionId);
          if (!existingSession) {
            await createSession(sessionId);
          }
        }

        send("status", { message: "Session ready", progress: 10, sessionId });

        const results: Array<{
          filename: string;
          documentType: string;
          chunks: number;
          pages: number;
          language?: string;
          success: boolean;
        }> = [];

        for (let i = 0; i < blobUrls.length; i++) {
          const blobUrl = blobUrls[i];
          const baseProgress = 10 + ((i / blobUrls.length) * 80);
          
          try {
            send("status", { 
              message: `Downloading file ${i + 1}...`, 
              progress: Math.round(baseProgress),
            });

            const { buffer, filename } = await fetchFileFromUrl(blobUrl.url);
            
            const ext = filename.toLowerCase().split(".").pop() || "";
            if (!SUPPORTED_EXTENSIONS.includes(ext)) {
              send("warning", { message: `Skipping ${filename}: unsupported format` });
              continue;
            }

            log("Processing file", { filename, size: buffer.length, hasPreExtracted: !!preExtractedText });
            send("status", { 
              message: `Analyzing ${filename}...`, 
              progress: Math.round(baseProgress + 10),
              currentFile: filename 
            });

            let doc: ProcessedDocument;
            
            if (preExtractedText && blobUrls.length === 1) {
              log("Using pre-extracted text from parallel processing");
              send("status", { message: "Using parallel-processed content...", progress: Math.round(baseProgress + 15) });
              
              const chunks = createChunksFromText(preExtractedText, pagesProcessed || 1);
              doc = {
                fullText: preExtractedText,
                chunks,
                documentType: "pdf",
                requiresOCR: true,
                metadata: {
                  filename,
                  pageCount: pagesProcessed || 1,
                  language: "English",
                  processingMethod: "hybrid"
                }
              };
            } else {
              doc = await processDocument(
                buffer, 
                filename,
                (step) => send("step", { message: step, file: filename })
              );
            }

            send("status", { 
              message: `Creating embeddings for ${filename}...`, 
              progress: Math.round(baseProgress + 25) 
            });

            const limitedChunks = doc.chunks.slice(0, MAX_CHUNKS_PER_FILE);
            
            const documentChunks: DocumentChunk[] = limitedChunks.map((chunk, index) => ({
              id: `${sessionId}_${filename}_${index}`,
              content: chunk.content,
              metadata: {
                filename: filename,
                pageNumber: chunk.pageNumber,
              },
            }));

            if (documentChunks.length > 0) {
              log("Generating embeddings", { count: documentChunks.length });
              
              const batchSize = 5;
              const allEmbeddings: number[][] = [];
              
              for (let j = 0; j < documentChunks.length; j += batchSize) {
                const batch = documentChunks.slice(j, j + batchSize);
                const embeddings = await generateEmbeddings(batch.map((c) => c.content));
                allEmbeddings.push(...embeddings);
                
                send("status", { 
                  message: `Embedding ${Math.min(j + batchSize, documentChunks.length)}/${documentChunks.length} chunks...`, 
                  progress: Math.round(baseProgress + 25 + (j / documentChunks.length) * 20) 
                });
              }
              
              send("status", { 
                message: `Indexing ${filename}...`, 
                progress: Math.round(baseProgress + 50) 
              });
              
              log("Upserting vectors", { sessionId });
              await upsertDocumentChunks(documentChunks, allEmbeddings, sessionId);
            }

            send("status", { 
              message: `Building knowledge graph for ${filename}...`, 
              progress: Math.round(baseProgress + 55) 
            });
            
            try {
              await extractEntitiesFromText(doc.fullText.substring(0, 8000), sessionId);
              log("Entities extracted for knowledge graph");
            } catch (kgError) {
              log("Knowledge graph extraction skipped", { error: String(kgError) });
            }

            await addDocument(sessionId, filename);

            results.push({
              filename: filename,
              documentType: doc.documentType,
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount,
              language: doc.metadata.language,
              success: true,
            });

            log("File processed", { 
              filename, 
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount 
            });
            
            send("file_complete", { 
              filename: filename, 
              documentType: doc.documentType,
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount,
              language: doc.metadata.language
            });

          } catch (error) {
            log("File error", { url: blobUrl.url, error: String(error) });
            send("file_error", { filename: blobUrl.filename || "Unknown", error: String(error) });
            results.push({
              filename: blobUrl.filename || "Unknown",
              documentType: "unknown",
              chunks: 0,
              pages: 0,
              success: false,
            });
          }
        }

        send("status", { message: "Finalizing...", progress: 95 });

        log("Upload complete", { sessionId, fileCount: results.length });
        send("complete", {
          success: true,
          sessionId,
          files: results,
          message: `Processed ${results.filter(r => r.success).length} file(s)`,
        });

      } catch (error) {
        log("Upload error", { error: String(error) });
        send("error", { message: String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

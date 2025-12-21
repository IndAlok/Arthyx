import { NextRequest } from "next/server";
import { processDocument, ProcessedDocument } from "@/lib/document-processor";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";
import { extractEntitiesFromText } from "@/lib/neo4j";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 25;

const log = (step: string, data?: object) => {
  console.log(`[UPLOAD] ${step}`, data ? JSON.stringify(data) : "");
};

const SUPPORTED_EXTENSIONS = [
  "pdf", "png", "jpg", "jpeg", "webp", "tiff",
  "doc", "docx", "xls", "xlsx", "csv",
  "txt", "md", "json", "xml", "html"
];

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`));
      };

      try {
        log("Upload started");
        send("status", { message: "Receiving files...", progress: 5 });
        
        const formData = await request.formData();
        const files = formData.getAll("files") as File[];
        let sessionId = formData.get("sessionId") as string | null;

        if (!files || files.length === 0) {
          send("error", { message: "No files provided" });
          controller.close();
          return;
        }

        log("Files received", { count: files.length });

        const validFiles: File[] = [];
        for (const file of files) {
          const ext = file.name.toLowerCase().split(".").pop() || "";
          if (!SUPPORTED_EXTENSIONS.includes(ext)) {
            send("warning", { message: `Skipping ${file.name}: unsupported format` });
            continue;
          }
          if (file.size > MAX_FILE_SIZE) {
            send("warning", { message: `Skipping ${file.name}: too large (max 4MB)` });
            continue;
          }
          validFiles.push(file);
        }

        if (validFiles.length === 0) {
          send("error", { message: "No valid files to process" });
          controller.close();
          return;
        }

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

        for (let i = 0; i < validFiles.length; i++) {
          const file = validFiles[i];
          const baseProgress = 10 + ((i / validFiles.length) * 80);
          
          try {
            log("Processing file", { filename: file.name, index: i });
            send("status", { 
              message: `Analyzing ${file.name}...`, 
              progress: Math.round(baseProgress),
              currentFile: file.name 
            });

            const buffer = Buffer.from(await file.arrayBuffer());
            
            const doc: ProcessedDocument = await processDocument(
              buffer, 
              file.name,
              (step) => send("step", { message: step, file: file.name })
            );

            send("status", { 
              message: `Creating embeddings for ${file.name}...`, 
              progress: Math.round(baseProgress + 20) 
            });

            const limitedChunks = doc.chunks.slice(0, MAX_CHUNKS_PER_FILE);
            
            const documentChunks: DocumentChunk[] = limitedChunks.map((chunk, index) => ({
              id: `${sessionId}_${file.name}_${index}`,
              content: chunk.content,
              metadata: {
                filename: file.name,
                pageNumber: chunk.pageNumber,
              },
            }));

            if (documentChunks.length > 0) {
              log("Generating embeddings", { count: documentChunks.length });
              const embeddings = await generateEmbeddings(
                documentChunks.map((c) => c.content)
              );
              
              send("status", { 
                message: `Indexing ${file.name}...`, 
                progress: Math.round(baseProgress + 30) 
              });
              
              log("Upserting vectors", { sessionId });
              await upsertDocumentChunks(documentChunks, embeddings, sessionId);
            }

            send("status", { 
              message: `Building knowledge graph for ${file.name}...`, 
              progress: Math.round(baseProgress + 35) 
            });
            
            try {
              await extractEntitiesFromText(doc.fullText.substring(0, 5000), sessionId);
              log("Entities extracted for knowledge graph");
            } catch (kgError) {
              log("Knowledge graph extraction skipped", { error: String(kgError) });
            }

            await addDocument(sessionId, file.name);

            results.push({
              filename: file.name,
              documentType: doc.documentType,
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount,
              language: doc.metadata.language,
              success: true,
            });

            log("File processed", { 
              filename: file.name, 
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount 
            });
            
            send("file_complete", { 
              filename: file.name, 
              documentType: doc.documentType,
              chunks: documentChunks.length,
              pages: doc.metadata.pageCount,
              language: doc.metadata.language
            });

          } catch (error) {
            log("File error", { filename: file.name, error: String(error) });
            send("file_error", { filename: file.name, error: String(error) });
            results.push({
              filename: file.name,
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

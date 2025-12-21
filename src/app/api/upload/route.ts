import { NextRequest, NextResponse } from "next/server";
import { processDocumentsInParallel, ProcessedDocument } from "@/lib/document-processor";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = [
  "pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp",
  "doc", "docx", "xls", "xlsx", "csv",
  "txt", "md", "json", "xml", "html"
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    let sessionId = formData.get("sessionId") as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const ext = file.name.toLowerCase().split(".").pop() || "";
      
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name}: Unsupported format`);
        continue;
      }
      
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File too large (max 4MB)`);
        continue;
      }
      
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      return NextResponse.json(
        { error: "No valid files to process", details: errors },
        { status: 400 }
      );
    }

    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      await createSession(sessionId);
    } else {
      const existingSession = await getSession(sessionId);
      if (!existingSession) {
        await createSession(sessionId);
      }
    }

    const fileData = await Promise.all(
      validFiles.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        filename: file.name,
      }))
    );

    const processedDocs = await processDocumentsInParallel(fileData);

    const results: Array<{
      filename: string;
      documentType: string;
      chunks: number;
      textLength: number;
      requiresOCR: boolean;
      success: boolean;
    }> = [];

    for (const doc of processedDocs) {
      const documentChunks: DocumentChunk[] = doc.chunks.slice(0, 20).map((chunk, index) => ({
        id: `${sessionId}_${doc.metadata.filename}_${index}`,
        content: chunk.content,
        metadata: {
          filename: doc.metadata.filename,
          pageNumber: chunk.pageNumber,
          boundingBox: chunk.boundingBox,
        },
      }));

      if (documentChunks.length > 0) {
        const embeddings = await generateEmbeddings(
          documentChunks.map((c) => c.content)
        );
        await upsertDocumentChunks(documentChunks, embeddings);
      }

      await addDocument(sessionId, doc.metadata.filename);

      results.push({
        filename: doc.metadata.filename,
        documentType: doc.documentType,
        chunks: documentChunks.length,
        textLength: doc.fullText.length,
        requiresOCR: doc.requiresOCR,
        success: true,
      });
    }

    return NextResponse.json({
      success: true,
      sessionId,
      files: results,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully processed ${results.length} file(s)`,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to process files", details: String(error) },
      { status: 500 }
    );
  }
}

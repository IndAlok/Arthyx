import { NextRequest, NextResponse } from "next/server";
import { processDocument } from "@/lib/ocr";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 8;

export async function POST(request: NextRequest) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Total upload size exceeds 10MB limit" },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    let sessionId = formData.get("sessionId") as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    const oversizedFiles = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      return NextResponse.json(
        {
          error: `Files too large (max 4MB each): ${oversizedFiles.map((f) => f.name).join(", ")}`,
        },
        { status: 413 }
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

    const results = [];

    for (const file of files.slice(0, 2)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file.name;

      const { chunks, fullText } = await processDocument(buffer, filename);

      const limitedChunks = chunks.slice(0, MAX_CHUNKS_PER_FILE);

      const documentChunks: DocumentChunk[] = limitedChunks.map((chunk, index) => ({
        id: `${sessionId}_${filename}_${index}`,
        content: chunk.content,
        metadata: {
          filename,
          pageNumber: chunk.pageNumber,
          boundingBox: chunk.boundingBox,
        },
      }));

      if (documentChunks.length > 0) {
        const batchSize = 4;
        for (let i = 0; i < documentChunks.length; i += batchSize) {
          const batch = documentChunks.slice(i, i + batchSize);
          const embeddings = await generateEmbeddings(
            batch.map((c) => c.content)
          );
          await upsertDocumentChunks(batch, embeddings);
        }
      }

      await addDocument(sessionId, filename);

      results.push({
        filename,
        chunks: documentChunks.length,
        textLength: fullText.length,
        success: true,
      });
    }

    return NextResponse.json({
      success: true,
      sessionId,
      files: results,
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

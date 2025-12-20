import { NextRequest, NextResponse } from "next/server";
import { processDocument } from "@/lib/ocr";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";

export const maxDuration = 60;

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

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file.name;

      const { chunks, fullText } = await processDocument(buffer, filename);

      const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
        id: `${sessionId}_${filename}_${index}`,
        content: chunk.content,
        metadata: {
          filename,
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

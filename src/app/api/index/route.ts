import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings } from "@/lib/gemini";
import { upsertDocumentChunks, DocumentChunk } from "@/lib/pinecone";
import { createSession, addDocument, getSession } from "@/lib/redis";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  console.log(`[INDEX] ${step}`, data ? JSON.stringify(data) : "");
};

interface IndexRequest {
  extractedText: string;
  filename: string;
  pages: number;
  sessionId?: string;
}

function createChunks(text: string, maxChunks: number = 50): Array<{ content: string; pageNumber: number; chunkIndex: number; type: string }> {
  const chunks: Array<{ content: string; pageNumber: number; chunkIndex: number; type: string }> = [];
  const chunkSize = 1000;
  const overlap = 150;
  
  const sectionPattern = /===\s*(?:PAGE|SECTION)\s*(\d+)\s*===/gi;
  const sections: Array<{ num: number; content: string }> = [];
  
  let lastIndex = 0;
  let currentNum = 1;
  let match;
  
  while ((match = sectionPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const content = text.substring(lastIndex, match.index).trim();
      if (content.length > 100) {
        sections.push({ num: currentNum, content });
      }
    }
    currentNum = parseInt(match[1], 10);
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    const content = text.substring(lastIndex).trim();
    if (content.length > 100) {
      sections.push({ num: currentNum, content });
    }
  }
  
  if (sections.length === 0 && text.length > 100) {
    sections.push({ num: 1, content: text });
  }

  for (const section of sections) {
    if (chunks.length >= maxChunks) break;
    
    let chunkCount = 0;
    for (let i = 0; i < section.content.length && chunkCount < 3 && chunks.length < maxChunks; i += chunkSize - overlap) {
      const chunk = section.content.substring(i, i + chunkSize).trim();
      if (chunk.length > 100) {
        chunks.push({
          content: chunk,
          pageNumber: section.num,
          chunkIndex: chunks.length,
          type: chunk.includes("|") ? "table" : "text",
        });
        chunkCount++;
      }
    }
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const body: IndexRequest = await request.json();
    const { extractedText, filename, pages, sessionId: existingSessionId } = body;
    
    log("Index request", { filename, pages, textLength: extractedText?.length, hasSession: !!existingSessionId });
    
    if (!extractedText || extractedText.length < 100) {
      return NextResponse.json({ error: "No text to index" }, { status: 400 });
    }

    let sessionId = existingSessionId;
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

    const chunks = createChunks(extractedText);
    log("Chunks created", { count: chunks.length });

    const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
      id: `${sessionId}_${filename}_${index}`,
      content: chunk.content,
      metadata: {
        filename,
        pageNumber: chunk.pageNumber,
      },
    }));

    if (documentChunks.length > 0) {
      const batchSize = 10;
      const allEmbeddings: number[][] = [];
      
      for (let i = 0; i < documentChunks.length; i += batchSize) {
        const batch = documentChunks.slice(i, i + batchSize);
        const embeddings = await generateEmbeddings(batch.map((c) => c.content));
        allEmbeddings.push(...embeddings);
      }

      await upsertDocumentChunks(documentChunks, allEmbeddings, sessionId);
      log("Chunks indexed", { count: documentChunks.length });
    }

    await addDocument(sessionId, filename);

    return NextResponse.json({
      success: true,
      sessionId,
      filename,
      pages,
      chunks: chunks.length,
    });
  } catch (error) {
    log("Index error", { error: String(error) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

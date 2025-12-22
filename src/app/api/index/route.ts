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

function createSemanticChunks(text: string, maxChunks: number = 75): Array<{ 
  content: string; 
  pageNumber: number; 
  chunkIndex: number; 
  type: "text" | "table" | "header" 
}> {
  const chunks: Array<{ content: string; pageNumber: number; chunkIndex: number; type: "text" | "table" | "header" }> = [];
  
  const pagePattern = /===\s*(?:PAGE|BATCH|SECTION|SHEET)[:\s]*(\d+)(?:[^\n]*)?===/gi;
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

  log("Pages parsed", { count: pages.length });

  for (const page of pages) {
    if (chunks.length >= maxChunks) break;
    
    const semanticChunks = semanticChunk(page.content, 500, 15);
    
    for (const chunkText of semanticChunks) {
      if (chunks.length >= maxChunks) break;
      if (chunkText.length < 50) continue;
      
      const isTable = chunkText.includes("|") && (chunkText.includes("---") || /\|\s*[\d₹]/.test(chunkText));
      const isHeader = /^#+\s/.test(chunkText) || /^[A-Z][A-Z\s]{10,}$/.test(chunkText.split("\n")[0]);
      
      chunks.push({
        content: chunkText,
        pageNumber: page.pageNumber,
        chunkIndex: chunks.length,
        type: isTable ? "table" : isHeader ? "header" : "text",
      });
    }
  }

  log("Semantic chunks created", { count: chunks.length });
  return chunks;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: IndexRequest = await request.json();
    const { extractedText, filename, pages, sessionId: existingSessionId } = body;
    
    log("Index request", { 
      filename, 
      pages, 
      textLength: extractedText?.length,
      hasSession: !!existingSessionId 
    });
    
    if (!extractedText || extractedText.length < 100) {
      return NextResponse.json({ error: "Insufficient text to index" }, { status: 400 });
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

    const chunks = createSemanticChunks(extractedText)
    log("Chunks prepared", { count: chunks.length });

    const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
      id: `${sessionId}_${filename.replace(/[^a-zA-Z0-9]/g, "_")}_${index}`,
      content: chunk.content,
      metadata: {
        filename,
        pageNumber: chunk.pageNumber,
        chunkType: chunk.type,
      },
    }));

    if (documentChunks.length > 0) {
      const batchSize = 10;
      const allEmbeddings: number[][] = [];
      
      log("Generating embeddings", { totalChunks: documentChunks.length, batchSize });
      
      for (let i = 0; i < documentChunks.length; i += batchSize) {
        const batch = documentChunks.slice(i, i + batchSize);
        const embeddings = await generateEmbeddings(batch.map((c) => c.content));
        allEmbeddings.push(...embeddings);
        log("Batch embedded", { batch: Math.floor(i / batchSize) + 1, total: Math.ceil(documentChunks.length / batchSize) });
      }

      await upsertDocumentChunks(documentChunks, allEmbeddings, sessionId);
      log("Chunks indexed", { count: documentChunks.length });
    }

    await addDocument(sessionId, filename);

    const processingTime = Date.now() - startTime;
    log("Indexing complete", { sessionId, chunks: chunks.length, processingTime });

    return NextResponse.json({
      success: true,
      sessionId,
      filename,
      pages,
      chunks: chunks.length,
      processingTime,
    });
  } catch (error) {
    log("Index error", { error: String(error) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

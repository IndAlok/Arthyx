import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import * as XLSX from "xlsx-js-style";

export type DocumentType = "pdf" | "image" | "word" | "excel" | "text" | "unknown";

export interface ProcessedDocument {
  fullText: string;
  chunks: DocumentChunk[];
  documentType: DocumentType;
  requiresOCR: boolean;
  metadata: {
    filename: string;
    pageCount: number;
    language?: string;
    processingMethod: "text_extraction" | "ocr" | "hybrid";
  };
}

export interface DocumentChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  type: "text" | "table" | "header";
}

const log = (step: string, data?: object) => {
  console.log(`[DOC-PROCESSOR] ${step}`, data ? JSON.stringify(data) : "");
};

function detectDocumentType(filename: string): DocumentType {
  const ext = filename.toLowerCase().split(".").pop() || "";
  
  const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];
  const wordExtensions = ["doc", "docx"];
  const excelExtensions = ["xls", "xlsx", "csv"];
  const textExtensions = ["txt", "md", "json", "xml", "html", "css", "js", "ts"];
  
  if (ext === "pdf") return "pdf";
  if (imageExtensions.includes(ext)) return "image";
  if (wordExtensions.includes(ext)) return "word";
  if (excelExtensions.includes(ext)) return "excel";
  if (textExtensions.includes(ext)) return "text";
  
  return "unknown";
}

async function extractTextFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    log("Word extraction error", { error: String(error) });
    return "";
  }
}

function extractTextFromExcel(buffer: Buffer): { text: string; sheets: number } {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let fullText = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      fullText += `\n=== SHEET: ${sheetName} ===\n`;
      if (jsonData.length > 0) {
        const headers = jsonData[0] || [];
        fullText += "| " + headers.map(String).join(" | ") + " |\n";
        fullText += "| " + headers.map(() => "---").join(" | ") + " |\n";
        for (let i = 1; i < Math.min(jsonData.length, 500); i++) {
          const row = jsonData[i] || [];
          fullText += "| " + row.map(String).join(" | ") + " |\n";
        }
      }
    }

    return { text: fullText, sheets: workbook.SheetNames.length };
  } catch (error) {
    log("Excel extraction error", { error: String(error) });
    return { text: "", sheets: 0 };
  }
}

function extractTextFromPlainText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

async function extractWithGeminiVision(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress?: (step: string) => void
): Promise<{ text: string; pages: number; language: string }> {
  log("Extracting with Gemini Vision", { filename, bufferSize: buffer.length });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const base64Data = buffer.toString("base64");

  const prompt = `You are a document OCR and extraction expert. Extract ALL text from this document with COMPLETE ACCURACY.

CRITICAL REQUIREMENTS:
1. Extract EVERY word, number, and symbol exactly as written
2. Preserve document structure with clear page markers: === PAGE X ===
3. For tables, use markdown format with | separators
4. For financial data: capture exact amounts, percentages, ratios
5. For Hindi/regional text: use proper Unicode characters
6. For charts/graphs: describe the data they represent

FINANCIAL DATA TO CAPTURE PRECISELY:
- All monetary amounts (₹, crores, lakhs, millions)
- Percentages and ratios (NPA%, CAR%, NIM%, ROA%, ROE%)
- Company names, dates, regulatory references
- Table headers and all cell values

Report at end: [TOTAL_PAGES: X] [LANGUAGE: X]

Extract COMPLETE text - do not summarize or skip sections.`;

  const MAX_RETRIES = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      onProgress?.(`Vision extraction attempt ${attempt}/${MAX_RETRIES}...`);
      
      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType, data: base64Data } },
      ]);

      const response = result.response.text();
      
      const pagesMatch = response.match(/\[TOTAL_PAGES:\s*(\d+)\]/);
      const pages = pagesMatch ? parseInt(pagesMatch[1], 10) : 1;
      
      const languageMatch = response.match(/\[LANGUAGE:\s*([^\]]+)\]/);
      const language = languageMatch ? languageMatch[1].trim() : "English";
      
      const text = response
        .replace(/\[TOTAL_PAGES:\s*\d+\]/g, "")
        .replace(/\[LANGUAGE:\s*[^\]]+\]/g, "")
        .trim();

      log("Vision extraction complete", { pages, textLength: text.length, attempt });
      
      return { text, pages, language };
    } catch (error) {
      lastError = error as Error;
      const errorStr = String(error);
      const isRateLimit = errorStr.includes("429") || errorStr.includes("Resource exhausted");
      
      log("Vision extraction attempt failed", { attempt, isRateLimit, error: errorStr.substring(0, 200) });
      
      if (attempt < MAX_RETRIES) {
        const baseDelay = isRateLimit ? 30000 : 5000;
        const delay = baseDelay * attempt;
        log("Retrying after delay", { delay, nextAttempt: attempt + 1 });
        onProgress?.(`Rate limited. Waiting ${delay / 1000}s before retry ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  log("Vision extraction failed after all retries", { error: String(lastError) });
  throw lastError || new Error("Vision extraction failed after max retries");
}

function semanticChunk(text: string, chunkSize: number = 500, overlapPercent: number = 15): string[] {
  const overlap = Math.floor(chunkSize * (overlapPercent / 100));
  const chunks: string[] = [];
  
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + " " + para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  
  if (currentChunk.trim().length > 50) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

function createChunksWithSemanticSplit(text: string, maxChunks: number = 50): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  
  const pagePattern = /===\s*(?:PAGE|SHEET)\s*[:\s]*(\d+)\s*===/gi;
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
    if (chunks.length >= maxChunks) break;
    
    const semanticChunks = semanticChunk(page.content, 500, 15);
    
    for (const chunkText of semanticChunks) {
      if (chunks.length >= maxChunks) break;
      if (chunkText.length < 50) continue;
      
      const isTable = chunkText.includes("|") && (chunkText.includes("---") || /\|\s*\d/.test(chunkText));
      const isHeader = /^#+\s/.test(chunkText) || /^[A-Z][A-Z\s]{5,}$/.test(chunkText.split("\n")[0]);
      
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

export async function processDocument(
  buffer: Buffer,
  filename: string,
  onProgress?: (step: string) => void
): Promise<ProcessedDocument> {
  const startTime = Date.now();
  const documentType = detectDocumentType(filename);
  log("Processing document", { filename, documentType, size: buffer.length });
  
  onProgress?.(`Analyzing ${documentType}...`);

  let fullText = "";
  let requiresOCR = false;
  let pageCount = 1;
  let language = "English";
  let processingMethod: "text_extraction" | "ocr" | "hybrid" = "text_extraction";

  switch (documentType) {
    case "text":
      fullText = extractTextFromPlainText(buffer);
      break;

    case "word":
      onProgress?.("Extracting Word content...");
      fullText = await extractTextFromWord(buffer);
      break;

    case "excel":
      onProgress?.("Processing spreadsheet...");
      const excelResult = extractTextFromExcel(buffer);
      fullText = excelResult.text;
      pageCount = excelResult.sheets;
      break;

    case "pdf":
    case "image":
      requiresOCR = true;
      processingMethod = "ocr";
      onProgress?.("Running vision extraction...");
      
      const mimeType = documentType === "pdf" ? "application/pdf" :
        filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const visionResult = await extractWithGeminiVision(buffer, mimeType, filename, onProgress);
      fullText = visionResult.text;
      pageCount = visionResult.pages;
      language = visionResult.language;
      break;

    default:
      fullText = extractTextFromPlainText(buffer);
  }

  onProgress?.("Creating semantic index...");
  const chunks = createChunksWithSemanticSplit(fullText);

  const processingTime = Date.now() - startTime;
  log("Document complete", { 
    filename, 
    processingTime,
    pages: pageCount,
    chunks: chunks.length,
    textLength: fullText.length
  });

  return {
    fullText,
    chunks,
    documentType,
    requiresOCR,
    metadata: { 
      filename, 
      pageCount,
      language,
      processingMethod
    },
  };
}

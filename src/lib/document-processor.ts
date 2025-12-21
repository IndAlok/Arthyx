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
  };
}

export interface DocumentChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
}

const log = (step: string, data?: object) => {
  console.log(`[DOC-PROCESSOR] ${step}`, data ? JSON.stringify(data) : "");
};

function detectDocumentType(filename: string): DocumentType {
  const ext = filename.toLowerCase().split(".").pop() || "";
  
  const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
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
  log("Extracting text from Word document");
  try {
    const result = await mammoth.extractRawText({ buffer });
    log("Word extraction complete", { length: result.value.length });
    return result.value;
  } catch (error) {
    log("Word extraction error", { error: String(error) });
    return "";
  }
}

function extractTextFromExcel(buffer: Buffer): string {
  log("Extracting text from Excel document");
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let fullText = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      fullText += `\n[Sheet: ${sheetName}]\n`;
      for (const row of jsonData) {
        if (row && row.length > 0) {
          fullText += (row || []).map(String).join(" | ") + "\n";
        }
      }
    }

    log("Excel extraction complete", { length: fullText.length });
    return fullText;
  } catch (error) {
    log("Excel extraction error", { error: String(error) });
    return "";
  }
}

function extractTextFromPlainText(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  log("Plain text extraction complete", { length: text.length });
  return text;
}

async function analyzeDocumentWithAI(
  buffer: Buffer, 
  mimeType: string,
  filename: string,
  onProgress?: (step: string) => void
): Promise<{ text: string; pageCount: number; usedOCR: boolean }> {
  log("Starting AI document analysis", { filename, mimeType });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");

  const prompt = `You are a document analysis expert. Analyze this document completely and extract ALL text content.

CRITICAL INSTRUCTIONS:
1. Extract text from EVERY page of the document
2. For multi-page documents, clearly mark page breaks as: [PAGE 1], [PAGE 2], etc.
3. Preserve table structures using markdown tables
4. Be extremely precise with all numbers, currencies (₹, $), percentages, and dates
5. Extract ALL financial data: amounts, account numbers, ratios, etc.
6. For Indian language text (Hindi, Tamil, Bengali, Gujarati), extract with proper Unicode

At the start, indicate: [PAGES: X] where X is the total page count

Then provide the complete extracted text with page markers.`;

  try {
    const startTime = Date.now();
    onProgress?.("Analyzing document with AI...");
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const response = result.response.text();
    
    const pageMatch = response.match(/\[PAGES:\s*(\d+)\]/);
    const pageCount = pageMatch ? parseInt(pageMatch[1], 10) : 1;
    
    const text = response
      .replace(/\[PAGES:\s*\d+\]/g, "")
      .trim();

    log("Document analysis complete", { 
      filename, 
      duration: Date.now() - startTime,
      textLength: text.length,
      pageCount 
    });

    onProgress?.(`Extracted ${pageCount} page(s)`);
    
    return { text, pageCount, usedOCR: true };
  } catch (error) {
    log("Document analysis error", { error: String(error), filename });
    throw error;
  }
}

function createSmartChunks(text: string, pageCount: number, maxChunks: number = 20): DocumentChunk[] {
  log("Creating smart chunks", { textLength: text.length, pageCount, maxChunks });
  
  const chunks: DocumentChunk[] = [];
  
  const pagePattern = /\[PAGE\s*(\d+)\]/gi;
  const pages: Array<{ pageNumber: number; content: string }> = [];
  
  let lastIndex = 0;
  let lastPage = 1;
  let match;
  
  while ((match = pagePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const content = text.substring(lastIndex, match.index).trim();
      if (content.length > 50) {
        pages.push({ pageNumber: lastPage, content });
      }
    }
    lastPage = parseInt(match[1], 10);
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    const content = text.substring(lastIndex).trim();
    if (content.length > 50) {
      pages.push({ pageNumber: lastPage, content });
    }
  }
  
  if (pages.length === 0) {
    pages.push({ pageNumber: 1, content: text });
  }
  
  const chunkSize = 600;
  const overlap = 100;
  
  for (const page of pages) {
    const pageText = page.content;
    
    for (let i = 0; i < pageText.length && chunks.length < maxChunks; i += chunkSize - overlap) {
      const chunk = pageText.substring(i, i + chunkSize).trim();
      if (chunk.length > 50) {
        chunks.push({
          content: chunk,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length,
        });
      }
    }
  }

  log("Smart chunks created", { count: chunks.length, pages: pages.length });
  return chunks;
}

export async function processDocument(
  buffer: Buffer,
  filename: string,
  onProgress?: (step: string) => void
): Promise<ProcessedDocument> {
  const documentType = detectDocumentType(filename);
  log("Processing document", { filename, documentType, size: buffer.length });
  
  onProgress?.(`Detected ${documentType} document`);

  let fullText = "";
  let requiresOCR = false;
  let pageCount = 1;

  switch (documentType) {
    case "text":
      onProgress?.("Extracting text content...");
      fullText = extractTextFromPlainText(buffer);
      break;

    case "word":
      onProgress?.("Processing Word document...");
      fullText = await extractTextFromWord(buffer);
      break;

    case "excel":
      onProgress?.("Processing spreadsheet data...");
      fullText = extractTextFromExcel(buffer);
      break;

    case "pdf":
      onProgress?.("Analyzing PDF document...");
      const pdfResult = await analyzeDocumentWithAI(
        buffer, 
        "application/pdf", 
        filename, 
        onProgress
      );
      fullText = pdfResult.text;
      pageCount = pdfResult.pageCount;
      requiresOCR = pdfResult.usedOCR;
      break;

    case "image":
      requiresOCR = true;
      onProgress?.("Extracting text from image...");
      const mimeType = filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      const imgResult = await analyzeDocumentWithAI(buffer, mimeType, filename, onProgress);
      fullText = imgResult.text;
      break;

    default:
      onProgress?.("Reading file content...");
      fullText = extractTextFromPlainText(buffer);
  }

  onProgress?.("Creating searchable index...");
  const chunks = createSmartChunks(fullText, pageCount);

  log("Document processing complete", { 
    filename, 
    documentType, 
    requiresOCR,
    textLength: fullText.length,
    pageCount,
    chunkCount: chunks.length 
  });

  return {
    fullText,
    chunks,
    documentType,
    requiresOCR,
    metadata: { filename, pageCount },
  };
}

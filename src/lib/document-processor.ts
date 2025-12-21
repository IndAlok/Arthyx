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
    pageCount?: number;
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
  log("Extracting plain text");
  const text = buffer.toString("utf-8");
  log("Plain text extraction complete", { length: text.length });
  return text;
}

async function performOCR(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  log("Starting OCR", { filename, mimeType });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");

  const prompt = `Extract all text content from this document. Return only the extracted text, nothing else. Be precise with numbers and financial data.`;

  try {
    const startTime = Date.now();
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const text = result.response.text();
    log("OCR complete", { 
      filename, 
      duration: Date.now() - startTime,
      textLength: text.length 
    });
    
    return text;
  } catch (error) {
    log("OCR error", { error: String(error), filename });
    throw error;
  }
}

function createChunks(text: string, maxChunks: number = 10): DocumentChunk[] {
  log("Creating chunks", { textLength: text.length, maxChunks });
  
  const chunks: DocumentChunk[] = [];
  const chunkSize = 500;
  
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += chunkSize) {
    const chunk = text.substring(i, i + chunkSize).trim();
    if (chunk.length > 30) {
      chunks.push({
        content: chunk,
        pageNumber: 1,
        chunkIndex: chunks.length,
      });
    }
  }

  log("Chunks created", { count: chunks.length });
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
    case "image":
      requiresOCR = true;
      onProgress?.("Analyzing document with AI vision...");
      const mimeType = documentType === "pdf" ? "application/pdf" : 
        filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      fullText = await performOCR(buffer, mimeType, filename);
      break;

    default:
      onProgress?.("Reading file content...");
      fullText = extractTextFromPlainText(buffer);
  }

  onProgress?.("Creating searchable index...");
  const chunks = createChunks(fullText);

  log("Document processing complete", { 
    filename, 
    documentType, 
    textLength: fullText.length,
    chunkCount: chunks.length 
  });

  return {
    fullText,
    chunks,
    documentType,
    requiresOCR,
    metadata: { filename },
  };
}

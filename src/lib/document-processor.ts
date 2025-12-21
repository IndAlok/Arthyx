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

async function intelligentPDFExtract(
  buffer: Buffer, 
  filename: string,
  onProgress?: (step: string) => void
): Promise<{ text: string; usedOCR: boolean }> {
  log("Starting intelligent PDF extraction", { filename });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");

  const prompt = `Analyze this PDF document and extract text.

IMPORTANT: First determine if this is:
1. A TEXT-BASED PDF (has selectable/searchable text) - extract the text directly
2. A SCANNED/IMAGE PDF (text is in images, not selectable) - perform OCR to extract text

At the start of your response, indicate the type:
[TYPE: TEXT-BASED] or [TYPE: SCANNED]

Then provide ALL the extracted text content. Be precise with numbers, financial data, and any text in Indian languages (Hindi, Tamil, Bengali, Gujarati, etc.).`;

  try {
    const startTime = Date.now();
    onProgress?.("Analyzing PDF content...");
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Data,
        },
      },
    ]);

    const response = result.response.text();
    const usedOCR = response.includes("[TYPE: SCANNED]");
    
    const text = response
      .replace(/\[TYPE: TEXT-BASED\]/g, "")
      .replace(/\[TYPE: SCANNED\]/g, "")
      .trim();

    log("PDF extraction complete", { 
      filename, 
      duration: Date.now() - startTime,
      textLength: text.length,
      usedOCR 
    });

    onProgress?.(usedOCR ? "Extracted via OCR (scanned PDF)" : "Extracted text (native PDF)");
    
    return { text, usedOCR };
  } catch (error) {
    log("PDF extraction error", { error: String(error), filename });
    throw error;
  }
}

async function performOCR(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  log("Starting OCR for image", { filename, mimeType });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");

  const prompt = `Extract all text content from this image. Return only the extracted text. Be precise with numbers and any text in Indian languages.`;

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
    log("Image OCR complete", { 
      filename, 
      duration: Date.now() - startTime,
      textLength: text.length 
    });
    
    return text;
  } catch (error) {
    log("Image OCR error", { error: String(error), filename });
    throw error;
  }
}

function createChunks(text: string, maxChunks: number = 8): DocumentChunk[] {
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
      onProgress?.("Analyzing PDF...");
      const pdfResult = await intelligentPDFExtract(buffer, filename, onProgress);
      fullText = pdfResult.text;
      requiresOCR = pdfResult.usedOCR;
      break;

    case "image":
      requiresOCR = true;
      onProgress?.("Extracting text from image...");
      const mimeType = filename.toLowerCase().endsWith(".png") ? "image/png" :
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
    requiresOCR,
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

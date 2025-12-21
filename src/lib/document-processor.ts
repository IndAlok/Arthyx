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

function extractTextFromExcel(buffer: Buffer): { text: string; sheets: number } {
  log("Extracting text from Excel document");
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let fullText = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      fullText += `\n## Sheet: ${sheetName}\n`;
      if (jsonData.length > 0) {
        const headers = jsonData[0] || [];
        fullText += "| " + headers.map(String).join(" | ") + " |\n";
        fullText += "| " + headers.map(() => "---").join(" | ") + " |\n";
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] || [];
          fullText += "| " + row.map(String).join(" | ") + " |\n";
        }
      }
    }

    log("Excel extraction complete", { length: fullText.length, sheets: workbook.SheetNames.length });
    return { text: fullText, sheets: workbook.SheetNames.length };
  } catch (error) {
    log("Excel extraction error", { error: String(error) });
    return { text: "", sheets: 0 };
  }
}

function extractTextFromPlainText(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  log("Plain text extraction complete", { length: text.length });
  return text;
}

async function analyzeDocumentWithVision(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress?: (step: string) => void
): Promise<{ text: string; pageCount: number; language: string }> {
  log("Starting Vision API analysis", { filename, mimeType, bufferSize: buffer.length });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");

  const prompt = `You are an expert document analyzer. Analyze this document with EXTREME precision.

CRITICAL INSTRUCTIONS:
1. First, count the EXACT number of pages in this document. Report as: [TOTAL_PAGES: X]
2. For EACH page, mark with: === PAGE X ===
3. Extract ALL text from EVERY page completely
4. Preserve table structures using markdown tables
5. For Indian languages (Hindi, Tamil, Bengali, Gujarati, Telugu, Marathi, Kannada, Malayalam), extract with proper Unicode
6. Be EXTREMELY precise with:
   - All numbers, amounts, and percentages
   - Dates and time periods
   - Company names and entity names
   - Regulatory references (SEBI, RBI circulars)
   - Account numbers and financial identifiers
7. Detect the primary language(s): [LANGUAGE: detected_language]

OUTPUT FORMAT:
[TOTAL_PAGES: X]
[LANGUAGE: detected_language]

=== PAGE 1 ===
[Complete content of page 1]

=== PAGE 2 ===
[Complete content of page 2]

... and so on for all pages`;

  try {
    const startTime = Date.now();
    onProgress?.("Analyzing document structure...");
    
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
    
    const pageCountMatch = response.match(/\[TOTAL_PAGES:\s*(\d+)\]/);
    const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 1;
    
    const languageMatch = response.match(/\[LANGUAGE:\s*([^\]]+)\]/);
    const language = languageMatch ? languageMatch[1].trim() : "English";
    
    const text = response
      .replace(/\[TOTAL_PAGES:\s*\d+\]/g, "")
      .replace(/\[LANGUAGE:\s*[^\]]+\]/g, "")
      .trim();

    log("Vision analysis complete", { 
      filename, 
      duration: Date.now() - startTime,
      textLength: text.length,
      pageCount,
      language
    });

    onProgress?.(`Processed ${pageCount} page(s) in ${language}`);
    
    return { text, pageCount, language };
  } catch (error) {
    log("Vision analysis error", { error: String(error), filename });
    throw error;
  }
}

function createSmartChunks(
  text: string, 
  pageCount: number, 
  maxChunksPerPage: number = 5
): DocumentChunk[] {
  log("Creating smart chunks", { textLength: text.length, pageCount, maxChunksPerPage });
  
  const chunks: DocumentChunk[] = [];
  
  const pagePattern = /===\s*PAGE\s*(\d+)\s*===/gi;
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

  log("Detected pages", { count: pages.length, pageNumbers: pages.map(p => p.pageNumber) });

  const chunkSize = 600;
  const overlap = 100;
  
  for (const page of pages) {
    const pageText = page.content;
    let pageChunks = 0;
    
    for (let i = 0; i < pageText.length && pageChunks < maxChunksPerPage; i += chunkSize - overlap) {
      const chunk = pageText.substring(i, i + chunkSize).trim();
      if (chunk.length > 50) {
        const isTable = chunk.includes("|") && chunk.includes("---");
        const isHeader = /^#+\s/.test(chunk) || /^[A-Z][A-Z\s]+$/.test(chunk.split("\n")[0]);
        
        chunks.push({
          content: chunk,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length,
          type: isTable ? "table" : isHeader ? "header" : "text",
        });
        pageChunks++;
      }
    }
  }

  log("Smart chunks created", { 
    totalChunks: chunks.length, 
    pagesProcessed: pages.length,
    chunksByPage: pages.map(p => chunks.filter(c => c.pageNumber === p.pageNumber).length)
  });
  
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
  let language = "English";
  let processingMethod: "text_extraction" | "ocr" | "hybrid" = "text_extraction";

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
      const excelResult = extractTextFromExcel(buffer);
      fullText = excelResult.text;
      pageCount = excelResult.sheets;
      break;

    case "pdf":
    case "image":
      requiresOCR = true;
      processingMethod = "ocr";
      onProgress?.("Analyzing with AI vision...");
      const mimeType = documentType === "pdf" ? "application/pdf" : 
        filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const result = await analyzeDocumentWithVision(buffer, mimeType, filename, onProgress);
      fullText = result.text;
      pageCount = result.pageCount;
      language = result.language;
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
    chunkCount: chunks.length,
    language
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

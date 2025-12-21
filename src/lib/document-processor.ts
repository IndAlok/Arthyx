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

function estimatePageCount(buffer: Buffer): number {
  const pdfString = buffer.toString("binary");
  const matches = pdfString.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

async function extractWithGemini(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  estimatedPages: number,
  onProgress?: (step: string) => void
): Promise<{ text: string; pages: number; language: string }> {
  log("Extracting with Gemini", { filename, estimatedPages, bufferSize: buffer.length });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const maxBytes = 10 * 1024 * 1024;
  const useBuffer = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
  const base64Data = useBuffer.toString("base64");

  const prompt = `You are a financial document analyzer. Extract ALL text content from this document with COMPLETE ACCURACY.

REQUIREMENTS:
1. Extract EVERY financial figure, amount, percentage, ratio
2. Include ALL company names, regulatory references (SEBI, RBI, Basel)
3. Preserve table data as markdown tables with | separators
4. For each distinct section/page, mark with: === PAGE X ===
5. Extract Indian language content (Hindi, Tamil, etc.) with proper Unicode
6. Report total pages: [TOTAL_PAGES: X]
7. Detect language: [LANGUAGE: X]

CRITICAL FINANCIAL DATA TO CAPTURE:
- NPA (GNPA, NNPA percentages)
- CAR (Capital Adequacy Ratio)
- NIM (Net Interest Margin)
- ROA, ROE percentages
- Total Assets, Liabilities, Revenue
- Profit/Loss figures
- All amounts in crores/lakhs

Extract the COMPLETE text, not summaries. Be thorough.`;

  try {
    const startTime = Date.now();
    onProgress?.(`Processing ${estimatedPages} pages with AI...`);
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64Data } },
    ]);

    const response = result.response.text();
    
    const pagesMatch = response.match(/\[TOTAL_PAGES:\s*(\d+)\]/);
    const pages = pagesMatch ? parseInt(pagesMatch[1], 10) : estimatedPages;
    
    const languageMatch = response.match(/\[LANGUAGE:\s*([^\]]+)\]/);
    const language = languageMatch ? languageMatch[1].trim() : "English";
    
    const text = response
      .replace(/\[TOTAL_PAGES:\s*\d+\]/g, "")
      .replace(/\[LANGUAGE:\s*[^\]]+\]/g, "")
      .trim();

    log("Gemini extraction complete", { 
      pages, 
      textLength: text.length,
      duration: Date.now() - startTime
    });
    
    onProgress?.(`Extracted ${pages} pages`);
    
    return { text, pages, language };
  } catch (error) {
    log("Gemini extraction error", { error: String(error) });
    throw error;
  }
}

function createChunks(text: string, maxChunks: number = 50): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const chunkSize = 1000;
  const overlap = 150;
  
  const pagePattern = /===\s*PAGE\s*(\d+)\s*===/gi;
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
    const lines = text.split("\n");
    const linesPerPage = Math.ceil(lines.length / 10);
    for (let i = 0; i < 10 && i * linesPerPage < lines.length; i++) {
      const pageContent = lines.slice(i * linesPerPage, (i + 1) * linesPerPage).join("\n");
      if (pageContent.trim().length > 100) {
        pages.push({ pageNumber: i + 1, content: pageContent });
      }
    }
  }

  log("Pages identified", { count: pages.length });

  for (const page of pages) {
    if (chunks.length >= maxChunks) break;
    
    const pageText = page.content;
    let pageChunks = 0;
    const maxChunksPerPage = 3;
    
    for (let i = 0; i < pageText.length && pageChunks < maxChunksPerPage && chunks.length < maxChunks; i += chunkSize - overlap) {
      const chunk = pageText.substring(i, i + chunkSize).trim();
      if (chunk.length > 100) {
        const isTable = chunk.includes("|") && (chunk.includes("---") || chunk.match(/\|\s*\d/));
        
        chunks.push({
          content: chunk,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length,
          type: isTable ? "table" : "text",
        });
        pageChunks++;
      }
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
  const startTime = Date.now();
  const documentType = detectDocumentType(filename);
  log("Processing", { filename, documentType, size: buffer.length });
  
  onProgress?.(`Processing ${documentType}...`);

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
      const estimatedPages = estimatePageCount(buffer);
      log("PDF estimated pages", { estimatedPages });
      
      requiresOCR = true;
      processingMethod = "ocr";
      
      const pdfResult = await extractWithGemini(
        buffer, 
        "application/pdf", 
        filename, 
        estimatedPages,
        onProgress
      );
      
      fullText = pdfResult.text;
      pageCount = pdfResult.pages;
      language = pdfResult.language;
      break;

    case "image":
      requiresOCR = true;
      processingMethod = "ocr";
      onProgress?.("Running OCR...");
      const mimeType = filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const imgResult = await extractWithGemini(buffer, mimeType, filename, 1, onProgress);
      fullText = imgResult.text;
      pageCount = imgResult.pages;
      language = imgResult.language;
      break;

    default:
      fullText = extractTextFromPlainText(buffer);
  }

  onProgress?.("Creating search index...");
  const chunks = createChunks(fullText);

  log("Complete", { 
    filename, 
    duration: Date.now() - startTime,
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

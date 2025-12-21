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
    processingMethod: "text_extraction" | "ocr" | "hybrid" | "sampled";
    pagesProcessed?: number;
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

const MAX_PAGES_TO_PROCESS = 60;
const MAX_PROCESSING_TIME_MS = 45000;

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
        for (let i = 1; i < Math.min(jsonData.length, 500); i++) {
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

function estimatePDFPageCount(buffer: Buffer): number {
  const pdfString = buffer.toString("binary");
  const matches = pdfString.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

function extractNativePDFText(buffer: Buffer): string {
  const pdfString = buffer.toString("binary");
  const textMatches = pdfString.match(/\(([^)]+)\)/g);
  
  if (!textMatches) return "";
  
  let text = textMatches
    .map(m => m.slice(1, -1))
    .filter(t => t.length > 2 && /[a-zA-Z0-9]/.test(t))
    .join(" ");
  
  text = text.replace(/\\n/g, "\n").replace(/\\r/g, "");
  
  return text;
}

async function analyzeDocumentWithVisionFast(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  estimatedPages: number,
  onProgress?: (step: string) => void
): Promise<{ text: string; pageCount: number; language: string; pagesProcessed: number }> {
  const startTime = Date.now();
  const pagesToProcess = Math.min(estimatedPages, MAX_PAGES_TO_PROCESS);
  
  log("Starting fast Vision analysis", { filename, estimatedPages, pagesToProcess });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = buffer.toString("base64");
  
  const isLargeDoc = estimatedPages > 50;
  
  const prompt = isLargeDoc ? 
    `Analyze this large document QUICKLY. Focus on KEY CONTENT ONLY.

INSTRUCTIONS:
1. Report total pages: [TOTAL_PAGES: X]
2. Extract ONLY the most important content from first ${pagesToProcess} pages:
   - Executive summaries, key findings
   - Important financial figures and ratios
   - Regulatory mentions (SEBI, RBI)
   - Major conclusions
3. Use format: === PAGE X === for each processed page
4. Skip repetitive content, headers/footers, boilerplate
5. Detect language: [LANGUAGE: X]

BE FAST - extract essence, not verbatim text.` :
    `Analyze this document precisely.

1. Count pages: [TOTAL_PAGES: X]
2. For each page: === PAGE X ===
3. Extract all text with financial precision
4. Preserve tables as markdown
5. Detect language: [LANGUAGE: X]`;

  try {
    onProgress?.(`Processing ${pagesToProcess}/${estimatedPages} pages...`);
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) {
      log("Approaching timeout, returning partial results");
    }

    const response = result.response.text();
    
    const pageCountMatch = response.match(/\[TOTAL_PAGES:\s*(\d+)\]/);
    const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : estimatedPages;
    
    const languageMatch = response.match(/\[LANGUAGE:\s*([^\]]+)\]/);
    const language = languageMatch ? languageMatch[1].trim() : "English";
    
    const text = response
      .replace(/\[TOTAL_PAGES:\s*\d+\]/g, "")
      .replace(/\[LANGUAGE:\s*[^\]]+\]/g, "")
      .trim();

    log("Fast Vision complete", { 
      duration: Date.now() - startTime,
      textLength: text.length,
      pageCount,
      pagesProcessed: pagesToProcess
    });

    onProgress?.(`Extracted ${pagesToProcess} key pages`);
    
    return { text, pageCount, language, pagesProcessed: pagesToProcess };
  } catch (error) {
    log("Vision analysis error", { error: String(error) });
    throw error;
  }
}

function createSmartChunks(
  text: string, 
  pageCount: number, 
  maxChunksPerPage: number = 3,
  maxTotalChunks: number = 25
): DocumentChunk[] {
  log("Creating smart chunks", { textLength: text.length, pageCount });
  
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

  const chunkSize = 800;
  const overlap = 100;
  
  for (const page of pages) {
    if (chunks.length >= maxTotalChunks) break;
    
    const pageText = page.content;
    let pageChunks = 0;
    
    for (let i = 0; i < pageText.length && pageChunks < maxChunksPerPage && chunks.length < maxTotalChunks; i += chunkSize - overlap) {
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

  log("Chunks created", { totalChunks: chunks.length });
  
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
  
  onProgress?.(`Analyzing ${documentType} document...`);

  let fullText = "";
  let requiresOCR = false;
  let pageCount = 1;
  let language = "English";
  let processingMethod: "text_extraction" | "ocr" | "hybrid" | "sampled" = "text_extraction";
  let pagesProcessed = 1;

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
      const estimatedPages = estimatePDFPageCount(buffer);
      log("PDF page estimate", { estimatedPages });
      
      const nativeText = extractNativePDFText(buffer);
      const hasNativeText = nativeText.length > 500;
      
      if (hasNativeText && estimatedPages > 100) {
        log("Large text PDF - using native extraction + sampling");
        processingMethod = "sampled";
        pageCount = estimatedPages;
        pagesProcessed = Math.min(estimatedPages, MAX_PAGES_TO_PROCESS);
        
        onProgress?.(`Large document (${estimatedPages} pages) - extracting key content...`);
        
        const result = await analyzeDocumentWithVisionFast(
          buffer, 
          "application/pdf", 
          filename, 
          estimatedPages,
          onProgress
        );
        
        fullText = result.text;
        language = result.language;
        pagesProcessed = result.pagesProcessed;
        requiresOCR = true;
      } else {
        requiresOCR = true;
        processingMethod = "ocr";
        onProgress?.(`Analyzing ${estimatedPages} page(s)...`);
        
        const result = await analyzeDocumentWithVisionFast(
          buffer, 
          "application/pdf", 
          filename, 
          estimatedPages,
          onProgress
        );
        
        fullText = result.text;
        pageCount = result.pageCount;
        language = result.language;
        pagesProcessed = result.pagesProcessed;
      }
      break;

    case "image":
      requiresOCR = true;
      processingMethod = "ocr";
      onProgress?.("Running OCR...");
      const mimeType = filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const imgResult = await analyzeDocumentWithVisionFast(buffer, mimeType, filename, 1, onProgress);
      fullText = imgResult.text;
      pageCount = imgResult.pageCount;
      language = imgResult.language;
      break;

    default:
      fullText = extractTextFromPlainText(buffer);
  }

  const processingTime = Date.now() - startTime;
  log("Text extraction complete", { processingTime, textLength: fullText.length });
  
  onProgress?.("Creating search index...");
  const chunks = createSmartChunks(fullText, pageCount);

  log("Document complete", { 
    filename, 
    processingTime,
    pageCount,
    pagesProcessed,
    chunkCount: chunks.length
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
      processingMethod,
      pagesProcessed
    },
  };
}

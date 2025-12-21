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

    return { text: fullText, sheets: workbook.SheetNames.length };
  } catch (error) {
    log("Excel extraction error", { error: String(error) });
    return { text: "", sheets: 0 };
  }
}

function extractTextFromPlainText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

function extractTextFromPDFNative(buffer: Buffer): { text: string; pages: number; hasText: boolean } {
  log("Extracting text from PDF natively");
  const startTime = Date.now();
  
  try {
    const pdfString = buffer.toString("binary");
    
    const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : 1;
    
    let extractedText = "";
    
    const streamPattern = /stream\s*([\s\S]*?)endstream/gi;
    let match;
    
    while ((match = streamPattern.exec(pdfString)) !== null) {
      const streamContent = match[1];
      
      const textMatches = streamContent.match(/\(([^)]+)\)/g);
      if (textMatches) {
        for (const textMatch of textMatches) {
          let text = textMatch.slice(1, -1);
          
          text = text
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "")
            .replace(/\\t/g, " ")
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\");
          
          if (text.length > 1 && /[a-zA-Z0-9]/.test(text)) {
            extractedText += text + " ";
          }
        }
      }
      
      const tjMatches = streamContent.match(/\[(.*?)\]\s*TJ/g);
      if (tjMatches) {
        for (const tjMatch of tjMatches) {
          const innerTexts = tjMatch.match(/\(([^)]*)\)/g);
          if (innerTexts) {
            for (const innerText of innerTexts) {
              let text = innerText.slice(1, -1);
              text = text.replace(/\\n/g, "\n").replace(/\\r/g, "");
              if (text.length > 0) {
                extractedText += text;
              }
            }
          }
        }
        extractedText += " ";
      }
    }
    
    extractedText = extractedText
      .replace(/\s+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim();
    
    const hasSubstantialText = extractedText.length > 300;
    
    let formattedText = "";
    if (hasSubstantialText && pageCount > 1) {
      const charsPerPage = Math.ceil(extractedText.length / pageCount);
      for (let i = 0; i < pageCount; i++) {
        const start = i * charsPerPage;
        const end = Math.min((i + 1) * charsPerPage, extractedText.length);
        const pageText = extractedText.substring(start, end).trim();
        if (pageText.length > 20) {
          formattedText += `=== PAGE ${i + 1} ===\n${pageText}\n\n`;
        }
      }
    } else {
      formattedText = extractedText;
    }
    
    log("PDF native extraction complete", { 
      pages: pageCount,
      textLength: extractedText.length,
      hasText: hasSubstantialText,
      duration: Date.now() - startTime
    });
    
    return { 
      text: formattedText || extractedText, 
      pages: pageCount,
      hasText: hasSubstantialText
    };
  } catch (error) {
    log("PDF native extraction error", { error: String(error) });
    return { text: "", pages: 1, hasText: false };
  }
}

async function ocrWithVisionFast(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress?: (step: string) => void
): Promise<{ text: string; pages: number; language: string }> {
  log("Running fast OCR with Gemini Vision", { filename });
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const maxSize = 4 * 1024 * 1024;
  const useBuffer = buffer.length > maxSize ? buffer.subarray(0, maxSize) : buffer;
  
  const base64Data = useBuffer.toString("base64");

  const prompt = `Extract text from this document QUICKLY. Focus on key content only.

Report: [PAGES: X] [LANGUAGE: X]

Extract:
- Headlines and summaries
- Key financial figures
- Company names
- Important dates

Format concisely. Skip decorative content.`;

  try {
    onProgress?.("Running OCR...");
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64Data } },
    ]);

    const response = result.response.text();
    
    const pagesMatch = response.match(/\[PAGES:\s*(\d+)\]/);
    const pages = pagesMatch ? parseInt(pagesMatch[1], 10) : 1;
    
    const languageMatch = response.match(/\[LANGUAGE:\s*([^\]]+)\]/);
    const language = languageMatch ? languageMatch[1].trim() : "English";
    
    const text = response
      .replace(/\[PAGES:\s*\d+\]/g, "")
      .replace(/\[LANGUAGE:\s*[^\]]+\]/g, "")
      .trim();

    log("OCR complete", { pages, textLength: text.length });
    
    return { text, pages, language };
  } catch (error) {
    log("OCR error", { error: String(error) });
    throw error;
  }
}

function createChunks(text: string, maxChunks: number = 25): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const chunkSize = 800;
  const overlap = 100;
  
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

  for (const page of pages) {
    if (chunks.length >= maxChunks) break;
    
    const pageText = page.content;
    let pageChunks = 0;
    
    for (let i = 0; i < pageText.length && pageChunks < 2 && chunks.length < maxChunks; i += chunkSize - overlap) {
      const chunk = pageText.substring(i, i + chunkSize).trim();
      if (chunk.length > 50) {
        const isTable = chunk.includes("|") && chunk.includes("---");
        
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
      onProgress?.("Extracting PDF text...");
      const pdfResult = extractTextFromPDFNative(buffer);
      pageCount = pdfResult.pages;
      
      if (pdfResult.hasText) {
        fullText = pdfResult.text;
        processingMethod = "text_extraction";
        log("PDF has text - no OCR needed", { pages: pageCount, textLength: fullText.length });
        onProgress?.(`Extracted text from ${pageCount} pages`);
      } else {
        onProgress?.("Scanned PDF - running OCR...");
        requiresOCR = true;
        processingMethod = "ocr";
        
        const ocrResult = await ocrWithVisionFast(buffer, "application/pdf", filename, onProgress);
        fullText = ocrResult.text;
        pageCount = ocrResult.pages;
        language = ocrResult.language;
      }
      break;

    case "image":
      requiresOCR = true;
      processingMethod = "ocr";
      onProgress?.("Running OCR...");
      const mimeType = filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const imgResult = await ocrWithVisionFast(buffer, mimeType, filename, onProgress);
      fullText = imgResult.text;
      pageCount = imgResult.pages;
      language = imgResult.language;
      break;

    default:
      fullText = extractTextFromPlainText(buffer);
  }

  onProgress?.("Creating index...");
  const chunks = createChunks(fullText);

  log("Complete", { 
    filename, 
    duration: Date.now() - startTime,
    pages: pageCount,
    chunks: chunks.length,
    method: processingMethod
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

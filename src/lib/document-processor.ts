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
    language?: string;
    tables?: TableData[];
  };
}

export interface DocumentChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  boundingBox?: BoundingBox;
  type: "text" | "table" | "header" | "paragraph";
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  pageNumber: number;
}

function detectDocumentType(filename: string, buffer: Buffer): DocumentType {
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
  
  const header = buffer.slice(0, 8).toString("hex");
  if (header.startsWith("25504446")) return "pdf";
  if (header.startsWith("ffd8ff")) return "image";
  if (header.startsWith("89504e47")) return "image";
  if (header.startsWith("504b0304")) return "word";
  
  return "unknown";
}

async function extractTextFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error("Word extraction error:", error);
    return "";
  }
}

function extractTextFromExcel(buffer: Buffer): { text: string; tables: TableData[] } {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const tables: TableData[] = [];
    let fullText = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      if (jsonData.length > 0) {
        const headers = (jsonData[0] || []).map(String);
        const rows = jsonData.slice(1).map(row => (row || []).map(String));
        
        tables.push({
          headers,
          rows,
          pageNumber: workbook.SheetNames.indexOf(sheetName) + 1,
        });
        
        fullText += `\n[Sheet: ${sheetName}]\n`;
        fullText += headers.join(" | ") + "\n";
        rows.forEach(row => {
          fullText += row.join(" | ") + "\n";
        });
      }
    }

    return { text: fullText, tables };
  } catch (error) {
    console.error("Excel extraction error:", error);
    return { text: "", tables: [] };
  }
}

function extractTextFromPlainText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

async function performAdvancedOCR(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<{ text: string; blocks: DocumentChunk[] }> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const base64Data = buffer.toString("base64");

  const prompt = `You are an expert document analyzer. Extract ALL content from this document with maximum accuracy.

IMPORTANT INSTRUCTIONS:
1. Extract EVERY piece of text, number, and symbol visible
2. Preserve table structures using markdown format
3. Identify headers, paragraphs, and data sections
4. For Indian languages (Hindi, Tamil, Bengali, Gujarati, etc.), extract with proper Unicode
5. For financial documents, be extremely precise with numbers, currencies, and percentages

OUTPUT FORMAT (JSON only, no markdown code blocks):
{
  "fullText": "complete extracted text preserving structure",
  "blocks": [
    {
      "content": "text content",
      "type": "header|paragraph|table|list",
      "position": {"x": 0, "y": 0, "width": 100, "height": 10},
      "confidence": 0.95
    }
  ],
  "tables": [
    {
      "headers": ["col1", "col2"],
      "rows": [["val1", "val2"]]
    }
  ],
  "language": "detected language(s)",
  "documentType": "invoice|balance_sheet|tax_form|report|letter|other"
}`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const responseText = result.response.text();
    
    const cleanedResponse = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      const blocks: DocumentChunk[] = (parsed.blocks || []).map(
        (b: { content: string; type: string; position?: BoundingBox }, index: number) => ({
          content: b.content,
          pageNumber: 1,
          chunkIndex: index,
          boundingBox: b.position,
          type: b.type || "paragraph",
        })
      );

      return {
        text: parsed.fullText || "",
        blocks,
      };
    }

    return { text: responseText, blocks: [] };
  } catch (error) {
    console.error("OCR Error:", error);
    throw error;
  }
}

function createChunks(text: string, chunkSize: number = 600, overlap: number = 100): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        pageNumber: 1,
        chunkIndex: chunkIndex++,
        type: "paragraph",
      });
      
      const words = currentChunk.split(" ");
      currentChunk = words.slice(-Math.floor(overlap / 5)).join(" ") + "\n\n" + paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim().length > 50) {
    chunks.push({
      content: currentChunk.trim(),
      pageNumber: 1,
      chunkIndex: chunkIndex,
      type: "paragraph",
    });
  }

  return chunks;
}

export async function processDocument(
  buffer: Buffer,
  filename: string
): Promise<ProcessedDocument> {
  const documentType = detectDocumentType(filename, buffer);
  let fullText = "";
  let blocks: DocumentChunk[] = [];
  let tables: TableData[] = [];
  let requiresOCR = false;

  switch (documentType) {
    case "text":
      fullText = extractTextFromPlainText(buffer);
      blocks = createChunks(fullText);
      break;

    case "word":
      fullText = await extractTextFromWord(buffer);
      blocks = createChunks(fullText);
      break;

    case "excel":
      const excelResult = extractTextFromExcel(buffer);
      fullText = excelResult.text;
      tables = excelResult.tables;
      blocks = createChunks(fullText);
      break;

    case "pdf":
    case "image":
      requiresOCR = true;
      const mimeType = documentType === "pdf" ? "application/pdf" : 
        filename.toLowerCase().endsWith(".png") ? "image/png" :
        filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
      
      const ocrResult = await performAdvancedOCR(buffer, mimeType, filename);
      fullText = ocrResult.text;
      blocks = ocrResult.blocks.length > 0 ? ocrResult.blocks : createChunks(fullText);
      break;

    default:
      fullText = extractTextFromPlainText(buffer);
      blocks = createChunks(fullText);
  }

  return {
    fullText,
    chunks: blocks,
    documentType,
    requiresOCR,
    metadata: {
      filename,
      tables: tables.length > 0 ? tables : undefined,
    },
  };
}

export async function processDocumentsInParallel(
  files: Array<{ buffer: Buffer; filename: string }>
): Promise<ProcessedDocument[]> {
  const textBasedDocs: Array<{ buffer: Buffer; filename: string; index: number }> = [];
  const ocrRequiredDocs: Array<{ buffer: Buffer; filename: string; index: number }> = [];

  files.forEach((file, index) => {
    const docType = detectDocumentType(file.filename, file.buffer);
    if (docType === "pdf" || docType === "image") {
      ocrRequiredDocs.push({ ...file, index });
    } else {
      textBasedDocs.push({ ...file, index });
    }
  });

  const textResults = await Promise.all(
    textBasedDocs.map(async (doc) => ({
      index: doc.index,
      result: await processDocument(doc.buffer, doc.filename),
    }))
  );

  const ocrResults: Array<{ index: number; result: ProcessedDocument }> = [];
  for (const doc of ocrRequiredDocs) {
    const result = await processDocument(doc.buffer, doc.filename);
    ocrResults.push({ index: doc.index, result });
  }

  const allResults = [...textResults, ...ocrResults];
  allResults.sort((a, b) => a.index - b.index);

  return allResults.map((r) => r.result);
}

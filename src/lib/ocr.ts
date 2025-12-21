import { GoogleGenerativeAI } from "@google/generative-ai";

interface OCRResult {
  text: string;
  pages: PageResult[];
}

interface PageResult {
  pageNumber: number;
  text: string;
  blocks: TextBlock[];
}

interface TextBlock {
  text: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

export async function performOCR(
  fileBuffer: Buffer,
  mimeType: string
): Promise<OCRResult> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const base64Data = fileBuffer.toString("base64");

  const prompt = `Extract all text from this document. Return ONLY the extracted text, nothing else. Include all numbers, tables, and text in any language.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: mimeType,
        data: base64Data,
      },
    },
  ]);

  const responseText = result.response.text();

  return {
    text: responseText,
    pages: [
      {
        pageNumber: 1,
        text: responseText,
        blocks: [],
      },
    ],
  };
}

export async function processDocument(
  fileBuffer: Buffer,
  filename: string
): Promise<{
  chunks: Array<{
    content: string;
    pageNumber: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
  fullText: string;
}> {
  const extension = filename.toLowerCase().split(".").pop();
  let mimeType = "application/pdf";
  
  switch (extension) {
    case "png":
      mimeType = "image/png";
      break;
    case "jpg":
    case "jpeg":
      mimeType = "image/jpeg";
      break;
    case "webp":
      mimeType = "image/webp";
      break;
    case "pdf":
      mimeType = "application/pdf";
      break;
  }

  const ocrResult = await performOCR(fileBuffer, mimeType);

  const chunks: Array<{
    content: string;
    pageNumber: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }> = [];

  if (ocrResult.text && ocrResult.text.length > 0) {
    const text = ocrResult.text;
    const chunkSize = 800;
    const overlap = 100;

    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.substring(i, i + chunkSize).trim();
      if (chunk.length > 50) {
        chunks.push({
          content: chunk,
          pageNumber: 1,
        });
      }
      if (chunks.length >= 10) break;
    }
  }

  return {
    chunks,
    fullText: ocrResult.text,
  };
}

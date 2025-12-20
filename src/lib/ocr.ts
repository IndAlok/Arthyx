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
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const base64Data = fileBuffer.toString("base64");

  const prompt = `Analyze this document and extract ALL text content with high precision.

For each text block detected, provide:
1. The exact text content
2. Approximate position (as percentage from top-left: x%, y%, width%, height%)
3. Confidence level (0-1)

Focus on:
- Financial figures, amounts, and numbers with exact precision
- Table data maintaining proper structure
- Headers, labels, and metadata
- Any text in Indian languages (Hindi, Tamil, Bengali, Gujarati, etc.)

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "fullText": "complete extracted text as a single string",
  "blocks": [
    {
      "text": "block text",
      "position": {"x": 10, "y": 5, "width": 30, "height": 5},
      "confidence": 0.95,
      "type": "header"
    }
  ],
  "tables": [
    {
      "headers": ["column1", "column2"],
      "rows": [["value1", "value2"]]
    }
  ],
  "language": "detected language(s)",
  "documentType": "invoice/balance_sheet/tax_form/report/other"
}`;

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

  try {
    const cleanedResponse = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.fullText || "",
        pages: [
          {
            pageNumber: 1,
            text: parsed.fullText || "",
            blocks: (parsed.blocks || []).map(
              (b: {
                text: string;
                position: { x: number; y: number; width: number; height: number };
                confidence: number;
              }) => ({
                text: b.text,
                boundingBox: b.position || { x: 0, y: 0, width: 100, height: 10 },
                confidence: b.confidence || 0.9,
              })
            ),
          },
        ],
      };
    }
  } catch {
    console.error("Failed to parse OCR response as JSON");
  }

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

  for (const page of ocrResult.pages) {
    if (page.blocks.length > 0) {
      for (const block of page.blocks) {
        if (block.text.trim().length > 20) {
          chunks.push({
            content: block.text.trim(),
            pageNumber: page.pageNumber,
            boundingBox: block.boundingBox,
          });
        }
      }
    } else if (page.text) {
      const sentences = page.text.split(/(?<=[.!?।])\s+/);
      let currentChunk = "";

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > 500) {
          if (currentChunk.trim().length > 20) {
            chunks.push({
              content: currentChunk.trim(),
              pageNumber: page.pageNumber,
            });
          }
          currentChunk = sentence;
        } else {
          currentChunk += " " + sentence;
        }
      }

      if (currentChunk.trim().length > 20) {
        chunks.push({
          content: currentChunk.trim(),
          pageNumber: page.pageNumber,
        });
      }
    }
  }

  if (chunks.length === 0 && ocrResult.text.length > 0) {
    chunks.push({
      content: ocrResult.text.substring(0, 1000),
      pageNumber: 1,
    });
  }

  return {
    chunks,
    fullText: ocrResult.text,
  };
}

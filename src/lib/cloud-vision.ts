import vision from "@google-cloud/vision";

const log = (step: string, data?: object) => {
  const timestamp = new Date().toISOString();
  console.log(`[CLOUD-VISION][${timestamp}] ${step}`, data ? JSON.stringify(data) : "");
};

export interface VisionExtractionResult {
  fullText: string;
  pages: VisionPage[];
  tables: VisionTable[];
  languages: string[];
  confidence: number;
}

export interface VisionPage {
  pageNumber: number;
  text: string;
  blocks: VisionBlock[];
}

export interface VisionBlock {
  text: string;
  type: "TEXT" | "TABLE" | "FIGURE" | "HEADER" | "FOOTER";
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface VisionTable {
  pageNumber: number;
  headers: string[];
  rows: string[][];
  markdown: string;
}

function createVisionClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY not configured");
  }
  
  return new vision.ImageAnnotatorClient({
    apiKey,
  });
}

export async function extractTextWithVision(
  pdfBuffer: Buffer,
  options: { 
    startPage?: number; 
    endPage?: number;
    extractTables?: boolean;
  } = {}
): Promise<VisionExtractionResult> {
  const { startPage = 1, endPage, extractTables = true } = options;
  
  log("Starting Cloud Vision extraction", { bufferSize: pdfBuffer.length, startPage, endPage });
  
  const client = createVisionClient();
  const startTime = Date.now();

  try {
    const inputConfig = {
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    };

    const features: { type: string }[] = [
      { type: "DOCUMENT_TEXT_DETECTION" },
    ];

    if (extractTables) {
      features.push({ type: "TEXT_DETECTION" });
    }

    const request = {
      requests: [
        {
          inputConfig,
          features,
          imageContext: {
            languageHints: ["en", "hi", "mr", "ta", "te", "gu", "bn", "kn", "ml", "pa"],
          },
        },
      ],
    };

    log("Calling Vision API", { features: features.map(f => f.type) });
    
    const [result] = await client.batchAnnotateFiles(request as any);
    
    if (!result.responses || result.responses.length === 0) {
      log("No responses from Vision API");
      return createEmptyResult();
    }

    const fileResponse = result.responses[0];
    if (!fileResponse.responses) {
      log("No page responses");
      return createEmptyResult();
    }

    const pages: VisionPage[] = [];
    const tables: VisionTable[] = [];
    const detectedLanguages = new Set<string>();
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (let i = 0; i < fileResponse.responses.length; i++) {
      const pageResponse = fileResponse.responses[i];
      const pageNumber = i + 1;

      if (startPage && pageNumber < startPage) continue;
      if (endPage && pageNumber > endPage) continue;

      const fullTextAnnotation = pageResponse.fullTextAnnotation;
      if (!fullTextAnnotation) continue;

      const pageText = fullTextAnnotation.text || "";
      const blocks: VisionBlock[] = [];

      if (fullTextAnnotation.pages) {
        for (const page of fullTextAnnotation.pages) {
          if (page.property?.detectedLanguages) {
            for (const lang of page.property.detectedLanguages) {
              if (lang.languageCode) {
                detectedLanguages.add(lang.languageCode);
              }
              if (lang.confidence) {
                totalConfidence += lang.confidence;
                confidenceCount++;
              }
            }
          }

          if (page.blocks) {
            for (const block of page.blocks) {
              const blockText = extractBlockText(block);
              const blockType = detectBlockType(block, blockText);
              
              blocks.push({
                text: blockText,
                type: blockType,
                boundingBox: extractBoundingBox(block.boundingBox),
                confidence: block.confidence || 0.9,
              });

              if (blockType === "TABLE" && extractTables) {
                const table = parseTableFromBlock(block, blockText, pageNumber);
                if (table) {
                  tables.push(table);
                }
              }
            }
          }
        }
      }

      pages.push({
        pageNumber,
        text: pageText,
        blocks,
      });
    }

    const fullText = pages.map(p => `=== PAGE ${p.pageNumber} ===\n${p.text}`).join("\n\n");
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0.9;

    log("Vision extraction complete", {
      pages: pages.length,
      tables: tables.length,
      languages: Array.from(detectedLanguages),
      confidence: avgConfidence.toFixed(2),
      duration: Date.now() - startTime,
    });

    return {
      fullText,
      pages,
      tables,
      languages: Array.from(detectedLanguages),
      confidence: avgConfidence,
    };

  } catch (error) {
    log("Vision extraction error", { error: String(error) });
    throw error;
  }
}

function extractBlockText(block: any): string {
  if (!block.paragraphs) return "";
  
  return block.paragraphs
    .map((para: any) => {
      if (!para.words) return "";
      return para.words
        .map((word: any) => {
          if (!word.symbols) return "";
          return word.symbols.map((s: any) => s.text || "").join("");
        })
        .join(" ");
    })
    .join("\n");
}

function detectBlockType(block: any, text: string): VisionBlock["type"] {
  const lowerText = text.toLowerCase();
  
  if (block.blockType === "TABLE") return "TABLE";
  if (block.blockType === "PICTURE") return "FIGURE";
  
  if (text.includes("|") && text.split("\n").filter((l: string) => l.includes("|")).length > 2) {
    return "TABLE";
  }
  
  if (lowerText.includes("total") || lowerText.includes("₹") || lowerText.includes("crore") ||
      lowerText.includes("lakh") || /\d+[,.]?\d*%/.test(text)) {
    if (text.split("\n").length > 3) return "TABLE";
  }
  
  if (/^(chapter|section|part|\d+\.)\s/i.test(text.trim())) return "HEADER";
  if (/^page\s*\d+$/i.test(text.trim())) return "FOOTER";
  
  return "TEXT";
}

function extractBoundingBox(box: any): VisionBlock["boundingBox"] {
  if (!box?.vertices || box.vertices.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  const xs = box.vertices.map((v: any) => v.x || 0);
  const ys = box.vertices.map((v: any) => v.y || 0);
  
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function parseTableFromBlock(block: any, text: string, pageNumber: number): VisionTable | null {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return null;

  const rows = lines.map(line => {
    if (line.includes("|")) {
      return line.split("|").map(cell => cell.trim()).filter(Boolean);
    }
    return line.split(/\s{2,}/).map(cell => cell.trim()).filter(Boolean);
  });

  if (rows.length < 2 || rows[0].length < 2) return null;

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const markdown = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...dataRows.map(row => `| ${row.join(" | ")} |`),
  ].join("\n");

  return {
    pageNumber,
    headers,
    rows: dataRows,
    markdown,
  };
}

function createEmptyResult(): VisionExtractionResult {
  return {
    fullText: "",
    pages: [],
    tables: [],
    languages: [],
    confidence: 0,
  };
}

export async function extractFinancialData(
  pdfBuffer: Buffer,
  options: { focusOnTables?: boolean } = {}
): Promise<{
  text: string;
  tables: VisionTable[];
  metrics: Record<string, string>;
}> {
  const result = await extractTextWithVision(pdfBuffer, { extractTables: true });
  
  const metrics: Record<string, string> = {};
  
  const patterns = [
    { key: "npa_gross", pattern: /Gross\s*NPA[:\s]*([0-9,.]+\s*%?)/i },
    { key: "npa_net", pattern: /Net\s*NPA[:\s]*([0-9,.]+\s*%?)/i },
    { key: "car", pattern: /CAR[:\s]*([0-9,.]+\s*%)/i },
    { key: "roa", pattern: /ROA[:\s]*([0-9,.]+\s*%)/i },
    { key: "roe", pattern: /ROE[:\s]*([0-9,.]+\s*%)/i },
    { key: "nim", pattern: /NIM[:\s]*([0-9,.]+\s*%)/i },
    { key: "total_income", pattern: /Total\s*Income[:\s]*₹?\s*([0-9,.]+\s*(?:Cr|Lakh)?)/i },
    { key: "net_profit", pattern: /Net\s*Profit[:\s]*₹?\s*([0-9,.]+\s*(?:Cr|Lakh)?)/i },
    { key: "deposits", pattern: /(?:Total\s*)?Deposits[:\s]*₹?\s*([0-9,.]+\s*(?:Cr|Lakh)?)/i },
    { key: "advances", pattern: /(?:Total\s*)?Advances[:\s]*₹?\s*([0-9,.]+\s*(?:Cr|Lakh)?)/i },
  ];

  for (const { key, pattern } of patterns) {
    const match = result.fullText.match(pattern);
    if (match) {
      metrics[key] = match[1].trim();
    }
  }

  log("Financial metrics extracted", { metricsFound: Object.keys(metrics).length });

  return {
    text: result.fullText,
    tables: result.tables,
    metrics,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  console.log(`[CHUNK-PROCESS] ${step}`, data ? JSON.stringify(data) : "");
};

export async function POST(request: NextRequest) {
  try {
    const { base64Data, filename, chunkIndex, totalChunks, mimeType } = await request.json();
    
    log("Processing chunk", { filename, chunkIndex, totalChunks, dataLength: base64Data?.length });
    
    if (!base64Data) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `You are extracting text from PART ${chunkIndex + 1} of ${totalChunks} of a financial document.

EXTRACT ALL TEXT WITH COMPLETE ACCURACY:
1. Every financial figure, amount, percentage, ratio
2. All company names, regulatory references (SEBI, RBI, Basel)
3. Table data as markdown tables
4. Mark each page: === PAGE X ===
5. Indian language content with proper Unicode

CRITICAL DATA TO CAPTURE:
- NPA ratios (GNPA, NNPA)
- Capital Adequacy Ratio (CAR)
- Net Interest Margin (NIM)
- ROA, ROE percentages
- Revenue, Profit/Loss, Total Assets
- All amounts (crores/lakhs)

Report: [PAGES: X] [LANGUAGE: X]
Extract COMPLETE text, not summaries.`;

    const startTime = Date.now();
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: mimeType || "application/pdf", data: base64Data } },
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

    log("Chunk processed", { 
      chunkIndex, 
      duration: Date.now() - startTime,
      textLength: text.length,
      pages
    });

    return NextResponse.json({
      success: true,
      chunkIndex,
      text,
      pages,
      language,
      processingTime: Date.now() - startTime,
    });
  } catch (error) {
    log("Chunk processing error", { error: String(error) });
    return NextResponse.json(
      { error: String(error), success: false },
      { status: 500 }
    );
  }
}

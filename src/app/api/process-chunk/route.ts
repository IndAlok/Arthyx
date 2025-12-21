import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  console.log(`[CHUNK-PROCESS] ${step}`, data ? JSON.stringify(data) : "");
};

export async function POST(request: NextRequest) {
  try {
    const { blobUrl, filename, startPage, endPage, totalPages } = await request.json();
    
    log("Processing page range", { filename, startPage, endPage, totalPages });
    
    if (!blobUrl) {
      return NextResponse.json({ error: "No blob URL provided" }, { status: 400 });
    }

    const response = await fetch(blobUrl);
    if (!response.ok) {
      log("Failed to fetch file", { status: response.status });
      return NextResponse.json({ error: "Failed to fetch file" }, { status: 400 });
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64Data = buffer.toString("base64");
    
    log("File fetched", { size: buffer.length, base64Length: base64Data.length });
    
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `You are analyzing a ${totalPages}-page PDF document.
Focus ONLY on extracting content from pages ${startPage} to ${endPage}.

EXTRACT WITH COMPLETE ACCURACY:
1. For each page in range ${startPage}-${endPage}, mark: === PAGE X ===
2. Extract ALL financial figures, amounts, percentages
3. Company names, regulatory references (SEBI, RBI, Basel)
4. Table data as markdown tables with | separators
5. Hindi/regional text with proper Unicode

CRITICAL FINANCIAL DATA:
- NPA ratios (GNPA, NNPA percentages)
- CAR (Capital Adequacy Ratio)
- NIM (Net Interest Margin)
- ROA, ROE percentages  
- Revenue, Profit amounts in crores/lakhs
- All key metrics and their values

Skip pages outside ${startPage}-${endPage} range.
Extract COMPLETE text, not summaries.`;

    const startTime = Date.now();
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "application/pdf", data: base64Data } },
    ]);

    const text = result.response.text();
    
    log("Page range processed", { 
      startPage, 
      endPage, 
      duration: Date.now() - startTime,
      textLength: text.length 
    });

    return NextResponse.json({
      success: true,
      startPage,
      endPage,
      text,
      processingTime: Date.now() - startTime,
    });
  } catch (error) {
    log("Processing error", { error: String(error) });
    return NextResponse.json(
      { error: String(error), success: false },
      { status: 500 }
    );
  }
}

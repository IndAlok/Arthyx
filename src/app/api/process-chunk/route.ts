import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const log = (step: string, data?: object) => {
  console.log(`[CHUNK-PROCESS] ${step}`, data ? JSON.stringify(data) : "");
};

export async function POST(request: NextRequest) {
  try {
    const { blobUrl, filename, startPage, endPage, totalPages } = await request.json();
    
    log("Processing chunk", { filename, startPage, endPage, totalPages });
    
    if (!blobUrl) {
      return NextResponse.json({ error: "No blob URL provided" }, { status: 400 });
    }

    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch file" }, { status: 400 });
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64Data = buffer.toString("base64");
    
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `Analyze this PDF document. Focus ONLY on pages ${startPage} to ${endPage} (out of ~${totalPages} total).

INSTRUCTIONS:
1. Extract content ONLY from pages ${startPage}-${endPage}
2. For each page in this range, use format: === PAGE X ===
3. Extract ALL important content:
   - Financial figures, amounts, percentages
   - Company names, regulatory references (SEBI, RBI)
   - Key findings, summaries, conclusions
   - Table data in markdown format
4. For Indian languages (Hindi, Tamil, Bengali, etc.), use proper Unicode
5. Be precise with numbers and dates

Skip pages outside the ${startPage}-${endPage} range.`;

    const startTime = Date.now();
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Data,
        },
      },
    ]);

    const text = result.response.text();
    
    log("Chunk processed", { 
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
    log("Chunk processing error", { error: String(error) });
    return NextResponse.json(
      { error: String(error), startPage: 0, endPage: 0 },
      { status: 500 }
    );
  }
}

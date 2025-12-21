import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const blob = await put(file.name, file, {
      access: "public",
    });

    return NextResponse.json({
      success: true,
      url: blob.url,
      filename: file.name,
      size: file.size,
    });
  } catch (error) {
    console.error("[BLOB] Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file", details: String(error) },
      { status: 500 }
    );
  }
}

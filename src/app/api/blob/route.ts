import { NextRequest, NextResponse } from "next/server";
import { getSignedUploadUrl } from "@/lib/supabase";

export const runtime = "edge";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { filename } = body;

    if (!filename) {
      return NextResponse.json({ error: "Filename required" }, { status: 400 });
    }

    const { signedUrl, path } = await getSignedUploadUrl(filename);

    return NextResponse.json({
      uploadUrl: signedUrl,
      path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId parameter" }, { status: 400 });
  }

  try {
    const status = await getJobStatus(jobId);
    
    if (!status) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch status", details: String(error) },
      { status: 500 }
    );
  }
}

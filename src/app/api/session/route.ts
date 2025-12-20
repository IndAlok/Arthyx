import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/redis";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const session = await getSession(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        documents: session.documents,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        lastActive: session.lastActive,
      },
      messages: session.messages,
    });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session", details: String(error) },
      { status: 500 }
    );
  }
}

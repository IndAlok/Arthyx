import { NextResponse } from "next/server";
import { healthCheck as neo4jHealthCheck } from "@/lib/neo4j";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  
  try {
    const neo4jStatus = await neo4jHealthCheck();
    
    const duration = Date.now() - startTime;
    
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      services: {
        neo4j: neo4jStatus,
      },
      message: "Keep-alive ping successful. Neo4j AuraDB is awake.",
    });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: String(error),
    }, { status: 500 });
  }
}

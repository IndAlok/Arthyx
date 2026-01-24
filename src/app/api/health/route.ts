import { NextResponse } from "next/server";
import { healthCheck as neo4jHealthCheck } from "@/lib/neo4j";
import { redisPing } from "@/lib/redis";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();

  const env = {
    google: !!process.env.GOOGLE_API_KEY,
    pineconeKey: !!process.env.PINECONE_API_KEY,
    pineconeHost: !!process.env.PINECONE_INDEX_HOST,
    upstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    upstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    supabaseUrl: !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    ),
    supabaseAnon: !!(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    ),
    neo4j: !!(
      process.env.NEO4J_URI &&
      process.env.NEO4J_USERNAME &&
      process.env.NEO4J_PASSWORD
    ),
  };

  const missingRequired: string[] = [];
  if (!env.google) missingRequired.push("GOOGLE_API_KEY");
  if (!env.pineconeKey) missingRequired.push("PINECONE_API_KEY");
  if (!env.pineconeHost) missingRequired.push("PINECONE_INDEX_HOST");
  if (!env.upstashUrl) missingRequired.push("UPSTASH_REDIS_REST_URL");
  if (!env.upstashToken) missingRequired.push("UPSTASH_REDIS_REST_TOKEN");
  if (!env.supabaseUrl)
    missingRequired.push("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  if (!env.supabaseAnon)
    missingRequired.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)",
    );

  const services: Record<string, any> = {};

  // Redis check (fast + cheap)
  if (env.upstashUrl && env.upstashToken) {
    try {
      await redisPing();
      services.redis = { status: "ok" };
    } catch (error) {
      services.redis = { status: "error", error: String(error) };
    }
  } else {
    services.redis = { status: "error", error: "Missing Upstash env vars" };
  }

  // Pinecone check (describe stats)
  if (env.pineconeKey && env.pineconeHost) {
    try {
      const normalizedHost = process.env
        .PINECONE_INDEX_HOST!.trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "");

      const res = await fetch(
        `https://${normalizedHost}/describe_index_stats`,
        {
          method: "POST",
          headers: {
            "Api-Key": process.env.PINECONE_API_KEY!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        services.pinecone = {
          status: "error",
          error: `HTTP ${res.status}: ${text || res.statusText}`,
        };
      } else {
        services.pinecone = { status: "ok" };
      }
    } catch (error) {
      services.pinecone = { status: "error", error: String(error) };
    }
  } else {
    services.pinecone = { status: "error", error: "Missing Pinecone env vars" };
  }

  // Neo4j is optional (we don't want this endpoint to fail your whole app)
  try {
    services.neo4j = await neo4jHealthCheck();
  } catch (error) {
    services.neo4j = {
      status: "error",
      connected: false,
      message: String(error),
    };
  }

  const duration = Date.now() - startTime;

  return NextResponse.json({
    status: missingRequired.length === 0 ? "ok" : "error",
    timestamp: new Date().toISOString(),
    duration: `${duration}ms`,
    missingRequired,
    envPresent: env,
    services,
    message:
      missingRequired.length === 0
        ? "Healthcheck ok"
        : "Missing required environment variables for API routes",
  });
}

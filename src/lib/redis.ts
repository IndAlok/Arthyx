import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

const log = (step: string, data?: object) => {
  console.log(`[REDIS] ${step}`, data ? JSON.stringify(data) : "");
};

function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

export interface ConversationMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isEdit?: boolean;
  sources?: Array<{
    filename: string;
    pageNumber: number;
    excerpt: string;
  }>;
}

export interface SessionData {
  messages: ConversationMessage[];
  documents: string[];
  createdAt: number;
  lastActive: number;
}

const SESSION_TTL = 24 * 60 * 60;
const CACHE_TTL = 3600;

export async function getSession(sessionId: string): Promise<SessionData | null> {
  const client = getRedisClient();
  const data = await client.get<SessionData>(`session:${sessionId}`);
  return data;
}

export async function createSession(sessionId: string): Promise<SessionData> {
  const client = getRedisClient();
  const session: SessionData = {
    messages: [],
    documents: [],
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  await client.setex(`session:${sessionId}`, SESSION_TTL, session);
  log("Session created", { sessionId });
  return session;
}

export async function addMessage(
  sessionId: string,
  message: ConversationMessage
): Promise<void> {
  const client = getRedisClient();
  let session = await getSession(sessionId);

  if (!session) {
    session = await createSession(sessionId);
    log("Session auto-created for message", { sessionId });
  }

  session.messages.push(message);
  session.lastActive = Date.now();

  if (session.messages.length > 50) {
    session.messages = session.messages.slice(-50);
  }

  await client.setex(`session:${sessionId}`, SESSION_TTL, session);
}

export async function addDocument(
  sessionId: string,
  filename: string
): Promise<void> {
  const client = getRedisClient();
  let session = await getSession(sessionId);

  if (!session) {
    session = await createSession(sessionId);
    log("Session auto-created for document", { sessionId });
  }

  if (!session.documents.includes(filename)) {
    session.documents.push(filename);
    session.lastActive = Date.now();
    await client.setex(`session:${sessionId}`, SESSION_TTL, session);
    log("Document added", { sessionId, filename, totalDocs: session.documents.length });
  }
}

export async function getConversationHistory(
  sessionId: string,
  limit: number = 10
): Promise<ConversationMessage[]> {
  const session = await getSession(sessionId);
  if (!session) return [];
  return session.messages.slice(-limit);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const client = getRedisClient();
  await client.del(`session:${sessionId}`);
  log("Session deleted", { sessionId });
}

export async function getCachedResponse(queryHash: string): Promise<string | null> {
  const client = getRedisClient();
  const cached = await client.get<string>(`cache:${queryHash}`);
  if (cached) {
    log("Cache hit", { queryHash });
  }
  return cached;
}

export async function setCachedResponse(queryHash: string, response: string): Promise<void> {
  const client = getRedisClient();
  await client.setex(`cache:${queryHash}`, CACHE_TTL, response);
  log("Cache set", { queryHash });
}

export async function getCachedEmbedding(textHash: string): Promise<number[] | null> {
  const client = getRedisClient();
  return await client.get<number[]>(`embed:${textHash}`);
}

export async function setCachedEmbedding(textHash: string, embedding: number[]): Promise<void> {
  const client = getRedisClient();
  await client.setex(`embed:${textHash}`, CACHE_TTL * 24, embedding);
}

export function createHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

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
  role: "user" | "assistant";
  content: string;
  timestamp: number;
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
  return session;
}

export async function addMessage(
  sessionId: string,
  message: ConversationMessage
): Promise<void> {
  const client = getRedisClient();
  const session = await getSession(sessionId);

  if (!session) {
    throw new Error("Session not found");
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
  const session = await getSession(sessionId);

  if (!session) {
    throw new Error("Session not found");
  }

  if (!session.documents.includes(filename)) {
    session.documents.push(filename);
    session.lastActive = Date.now();
    await client.setex(`session:${sessionId}`, SESSION_TTL, session);
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
}

type UpstashResult<T> = { result: T };

const log = (step: string, data?: object) => {
  console.log(`[REDIS] ${step}`, data ? JSON.stringify(data) : "");
};

function getUpstashConfig(): { url: string; token: string } {
  const normalize = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    // Handle accidental quotes from copy/paste:  "..."  or  '...'
    return trimmed.replace(/^['"]/, "").replace(/['"]$/, "");
  };

  const url = normalize(process.env.UPSTASH_REDIS_REST_URL);
  const token = normalize(process.env.UPSTASH_REDIS_REST_TOKEN);

  if (!url || !token) {
    throw new Error(
      "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }

  return { url, token };
}

async function upstashCommand<T>(command: Array<string | number>): Promise<T> {
  const { url, token } = getUpstashConfig();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Upstash request failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const data = (await res.json()) as UpstashResult<T>;
  return data.result;
}

async function getJson<T>(key: string): Promise<T | null> {
  const value = await upstashCommand<string | null>(["GET", key]);
  if (value == null) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      // Not JSON
    }
  }
  return value as unknown as T;
}

async function setJson(
  key: string,
  ttlSeconds: number,
  value: unknown,
): Promise<void> {
  await upstashCommand<string>([
    "SETEX",
    key,
    ttlSeconds,
    JSON.stringify(value),
  ]);
}

async function delKey(key: string): Promise<void> {
  await upstashCommand<number>(["DEL", key]);
}

export async function redisPing(): Promise<void> {
  await upstashCommand<string>(["PING"]);
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

export interface JobStatus {
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  result?: any;
  error?: string;
  updatedAt: number;
}

const SESSION_TTL = 24 * 60 * 60;
const CACHE_TTL = 3600;
const JOB_TTL = 3600; // 1 hour

export async function getSession(
  sessionId: string,
): Promise<SessionData | null> {
  return await getJson<SessionData>(`session:${sessionId}`);
}

export async function createSession(sessionId: string): Promise<SessionData> {
  const session: SessionData = {
    messages: [],
    documents: [],
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  await setJson(`session:${sessionId}`, SESSION_TTL, session);
  log("Session created", { sessionId });
  return session;
}

export async function addMessage(
  sessionId: string,
  message: ConversationMessage,
): Promise<void> {
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

  await setJson(`session:${sessionId}`, SESSION_TTL, session);
}

export async function addDocument(
  sessionId: string,
  filename: string,
): Promise<void> {
  let session = await getSession(sessionId);

  if (!session) {
    session = await createSession(sessionId);
    log("Session auto-created for document", { sessionId });
  }

  if (!session.documents.includes(filename)) {
    session.documents.push(filename);
    session.lastActive = Date.now();
    await setJson(`session:${sessionId}`, SESSION_TTL, session);
    log("Document added", {
      sessionId,
      filename,
      totalDocs: session.documents.length,
    });
  }
}

export async function getConversationHistory(
  sessionId: string,
  limit: number = 10,
): Promise<ConversationMessage[]> {
  const session = await getSession(sessionId);
  if (!session) return [];
  return session.messages.slice(-limit);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await delKey(`session:${sessionId}`);
  log("Session deleted", { sessionId });
}

export async function getCachedResponse(
  queryHash: string,
): Promise<string | null> {
  const cached = await upstashCommand<string | null>([
    "GET",
    `cache:${queryHash}`,
  ]);
  if (cached) {
    log("Cache hit", { queryHash });
  }
  return cached;
}

export async function setCachedResponse(
  queryHash: string,
  response: string,
): Promise<void> {
  await upstashCommand<string>([
    "SETEX",
    `cache:${queryHash}`,
    CACHE_TTL,
    response,
  ]);
  log("Cache set", { queryHash });
}

export async function getCachedEmbedding(
  textHash: string,
): Promise<number[] | null> {
  return await getJson<number[]>(`embed:${textHash}`);
}

export async function setCachedEmbedding(
  textHash: string,
  embedding: number[],
): Promise<void> {
  await setJson(`embed:${textHash}`, CACHE_TTL * 24, embedding);
}

export async function updateJobStatus(
  jobId: string,
  status: Partial<JobStatus>,
): Promise<void> {
  const currentKey = `job:${jobId}`;

  const current = (await getJson<JobStatus>(currentKey)) || {
    status: "pending",
    progress: 0,
    message: "Initializing...",
    updatedAt: Date.now(),
  };

  const updated: JobStatus = {
    ...current,
    ...status,
    updatedAt: Date.now(),
  };

  await setJson(currentKey, JOB_TTL, updated);
  // Only log significant status changes to avoid noise
  if (status.status && status.status !== current.status) {
    log("Job status updated", {
      jobId,
      status: status.status,
      progress: status.progress,
    });
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  return await getJson<JobStatus>(`job:${jobId}`);
}

export function createHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

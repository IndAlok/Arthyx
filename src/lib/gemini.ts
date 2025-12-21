import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  }
  return genAI;
}

export function getEmbeddingModel(): GenerativeModel {
  return getClient().getGenerativeModel({ model: "text-embedding-004" });
}

export function getChatModel(): GenerativeModel {
  return getClient().getGenerativeModel({ model: "gemini-3-flash-preview" });
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  const embeddings: number[][] = [];

  for (const text of texts) {
    const result = await model.embedContent(text);
    embeddings.push(result.embedding.values);
  }

  return embeddings;
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export async function generateChatResponse(
  messages: ChatMessage[],
  context: string,
  systemPrompt?: string
): Promise<string> {
  const model = getChatModel();

  const defaultSystemPrompt = `You are Arthyx, an advanced financial document analysis assistant specialized in Indian financial data.

Your capabilities:
- Analyze financial documents in multiple languages (English, Hindi, Tamil, Bengali, Gujarati)
- Extract and interpret financial metrics, ratios, and trends
- Provide insights derived from uploaded documents
- Generate visualizations when requested
- Cross-reference information across multiple documents

Guidelines:
- Always cite your sources with page numbers when referencing document content
- Be precise with financial figures and calculations
- Explain complex financial concepts in simple terms
- If information is not in the documents, clearly state so
- For visualization requests, respond with JSON in the format: {"chart": {"type": "bar|line|pie", "data": [...], "title": "..."}}`;

  const fullPrompt = `${systemPrompt || defaultSystemPrompt}

DOCUMENT CONTEXT:
${context}

CONVERSATION:
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Respond helpfully and accurately based on the document context provided.`;

  const result = await model.generateContent(fullPrompt);
  return result.response.text();
}

export async function generateChartConfig(
  query: string,
  documentData: string
): Promise<object | null> {
  const model = getChatModel();

  const prompt = `Based on this query and document data, generate a chart configuration if visualization is appropriate.

Query: ${query}
Document Data: ${documentData}

If a chart would be helpful, respond ONLY with valid JSON in this exact format:
{
  "type": "bar" | "line" | "pie" | "area",
  "title": "Chart Title",
  "data": [{"name": "Label", "value": 123}, ...]
}

If no chart is appropriate, respond with: null`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  try {
    if (text === "null") return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

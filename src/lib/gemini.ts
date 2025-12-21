import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

const log = (step: string, data?: object) => {
  console.log(`[GEMINI] ${step}`, data ? JSON.stringify(data) : "");
};

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
  return getClient().getGenerativeModel({ model: "gemini-2.0-flash-exp" });
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  log("Generating embeddings", { count: texts.length });
  const model = getEmbeddingModel();
  const embeddings: number[][] = [];
  const startTime = Date.now();

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const truncatedText = text.length > 1500 ? text.substring(0, 1500) : text;
    
    try {
      const result = await model.embedContent(truncatedText);
      embeddings.push(result.embedding.values);
      log("Embedding generated", { index: i, length: truncatedText.length });
    } catch (error) {
      log("Embedding error", { index: i, error: String(error) });
      embeddings.push(new Array(768).fill(0));
    }
  }

  log("All embeddings complete", { 
    count: embeddings.length, 
    duration: Date.now() - startTime 
  });
  
  return embeddings;
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface SourceContext {
  filename: string;
  pageNumber: number;
  excerpt: string;
  relevanceScore: number;
}

export async function generateChatResponse(
  messages: ChatMessage[],
  context: string,
  sources: SourceContext[]
): Promise<{ response: string; citedSources: SourceContext[] }> {
  log("Generating chat response", { messageCount: messages.length });
  const model = getChatModel();
  const startTime = Date.now();

  const systemPrompt = `You are Arthyx, an advanced financial document analysis assistant.

CAPABILITIES:
- Analyze financial documents in multiple languages (English, Hindi, Tamil, Bengali, Gujarati)
- Extract and interpret financial metrics and trends
- Provide insights from uploaded documents
- Generate visualizations when requested

GUIDELINES:
1. Be precise with financial figures
2. Reference sources when citing document content
3. If information is not in documents, say so clearly
4. For charts, respond with JSON: {"chart": {"type": "bar|line|pie", "data": [...], "title": "..."}}`;

  const formattedContext = sources.length > 0 
    ? sources.map(s => `[${s.filename}, Page ${s.pageNumber}]\n${s.excerpt}`).join("\n\n---\n\n")
    : context;

  const fullPrompt = `${systemPrompt}

DOCUMENT CONTEXT:
${formattedContext}

CONVERSATION:
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Respond helpfully based on the document context.`;

  try {
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    log("Chat response generated", { 
      duration: Date.now() - startTime,
      responseLength: responseText.length 
    });

    return {
      response: responseText,
      citedSources: sources.slice(0, 3),
    };
  } catch (error) {
    log("Chat error", { error: String(error) });
    throw error;
  }
}

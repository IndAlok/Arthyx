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

  const batchSize = 5;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchPromises = batch.map(async (text) => {
      const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text;
      const result = await model.embedContent(truncatedText);
      return result.embedding.values;
    });
    
    const batchResults = await Promise.all(batchPromises);
    embeddings.push(...batchResults);
  }

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
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export async function generateChatResponse(
  messages: ChatMessage[],
  context: string,
  sources: SourceContext[],
  systemPrompt?: string
): Promise<{ response: string; citedSources: SourceContext[] }> {
  const model = getChatModel();

  const defaultSystemPrompt = `You are Arthyx, an advanced financial document analysis assistant specialized in Indian financial data.

CAPABILITIES:
- Analyze financial documents in multiple languages (English, Hindi, Tamil, Bengali, Gujarati)
- Extract and interpret financial metrics, ratios, and trends
- Provide insights derived from uploaded documents
- Generate visualizations when requested (respond with JSON chart config)
- Cross-reference information across multiple documents

RESPONSE GUIDELINES:
1. Always be precise with financial figures and calculations
2. When referencing document content, use [Source: filename, Page X] format
3. Explain complex financial concepts in simple terms
4. If information is not in the documents, clearly state so
5. For visualization requests, include JSON: {"chart": {"type": "bar|line|pie|area", "data": [...], "title": "..."}}

IMPORTANT: At the end of your response, list all sources you referenced in this format:
[SOURCES]
- filename: "name", page: X, excerpt: "relevant quote"
[/SOURCES]`;

  const formattedContext = sources.length > 0 
    ? sources.map(s => `[${s.filename}, Page ${s.pageNumber}] (${(s.relevanceScore * 100).toFixed(0)}% relevance)\n${s.excerpt}`).join("\n\n---\n\n")
    : context;

  const fullPrompt = `${systemPrompt || defaultSystemPrompt}

DOCUMENT CONTEXT:
${formattedContext}

CONVERSATION:
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Respond helpfully and accurately based on the document context provided.`;

  const result = await model.generateContent(fullPrompt);
  const responseText = result.response.text();

  const citedSources: SourceContext[] = [];
  const sourceMatches = responseText.matchAll(/\[Source:\s*([^,\]]+),?\s*Page\s*(\d+)\]/gi);
  
  for (const match of sourceMatches) {
    const filename = match[1].trim();
    const pageNumber = parseInt(match[2], 10);
    
    const matchingSource = sources.find(
      s => s.filename.toLowerCase().includes(filename.toLowerCase()) && s.pageNumber === pageNumber
    );
    
    if (matchingSource && !citedSources.some(s => s.filename === matchingSource.filename && s.pageNumber === matchingSource.pageNumber)) {
      citedSources.push(matchingSource);
    }
  }

  if (citedSources.length === 0 && sources.length > 0) {
    citedSources.push(...sources.slice(0, 3));
  }

  return {
    response: responseText,
    citedSources,
  };
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}

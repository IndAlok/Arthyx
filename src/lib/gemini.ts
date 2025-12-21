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
    } catch (error) {
      log("Embedding error", { index: i, error: String(error) });
      embeddings.push(new Array(768).fill(0));
    }
  }

  log("Embeddings complete", { 
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
  chunkIndex?: number;
}

export interface ChatResponse {
  response: string;
  citedSources: SourceContext[];
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area";
    title: string;
    data: Array<{ name: string; value: number }>;
  };
}

export async function generateChatResponse(
  messages: ChatMessage[],
  sources: SourceContext[],
  documentFilenames: string[]
): Promise<ChatResponse> {
  log("Generating chat response", { 
    messageCount: messages.length,
    sourceCount: sources.length,
    documents: documentFilenames 
  });
  
  const model = getChatModel();
  const startTime = Date.now();

  const systemPrompt = `You are **Arthyx**, an advanced financial document analysis assistant specialized in Indian financial data, regulations, and multi-language documents.

## Your Capabilities
- Analyze financial documents in multiple languages (English, Hindi, Tamil, Bengali, Gujarati)
- Extract financial metrics, ratios, trends, and insights
- Generate visualizations when data warrants visual representation
- Cross-reference information across uploaded documents

## Response Format
**ALWAYS use rich Markdown formatting:**
- Use **bold** for key terms and numbers
- Use headers (##, ###) to organize complex responses
- Use bullet points and numbered lists
- Use tables for comparative data
- Use \`code\` formatting for specific values

## Documents Currently Available
${documentFilenames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

## Citation Rules
1. When referencing document content, use format: **[Source: filename, Page X]**
2. Be specific about which document and page the information comes from
3. If information is NOT in the provided documents, clearly state: "This information is not available in the uploaded documents."

## Visualization Rules
When the query asks for visualization or when data naturally suits visual representation, include a JSON chart configuration:
\`\`\`chart
{"type": "bar|line|pie|area", "title": "Chart Title", "data": [{"name": "Label", "value": 123}]}
\`\`\`

## Context from Documents
${sources.map((s, i) => `
### Source ${i + 1}: ${s.filename} (Page ${s.pageNumber}) [${(s.relevanceScore * 100).toFixed(0)}% relevant]
${s.excerpt}
`).join("\n---\n")}`;

  const conversationHistory = messages.map((m) => 
    `**${m.role === "user" ? "User" : "Arthyx"}:** ${m.content}`
  ).join("\n\n");

  const fullPrompt = `${systemPrompt}

## Conversation
${conversationHistory}

Provide a comprehensive, well-formatted response using Markdown. Include relevant visualizations if appropriate.`;

  try {
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    log("Response generated", { 
      duration: Date.now() - startTime,
      responseLength: responseText.length 
    });

    let chartConfig = undefined;
    const chartMatch = responseText.match(/```chart\n?([\s\S]*?)```/);
    if (chartMatch) {
      try {
        chartConfig = JSON.parse(chartMatch[1].trim());
        log("Chart config extracted", { type: chartConfig.type });
      } catch {
        log("Chart parse error");
      }
    }

    const cleanedResponse = responseText
      .replace(/```chart\n?[\s\S]*?```/g, "")
      .trim();

    const citedSources: SourceContext[] = [];
    const sourceRegex = /\[Source:\s*([^,\]]+),?\s*Page\s*(\d+)\]/gi;
    let match;
    
    while ((match = sourceRegex.exec(responseText)) !== null) {
      const filename = match[1].trim();
      const pageNumber = parseInt(match[2], 10);
      
      const matchingSource = sources.find(
        s => s.filename.toLowerCase().includes(filename.toLowerCase()) || 
             filename.toLowerCase().includes(s.filename.toLowerCase())
      );
      
      if (matchingSource && !citedSources.some(
        cs => cs.filename === matchingSource.filename && cs.pageNumber === pageNumber
      )) {
        citedSources.push({
          ...matchingSource,
          pageNumber,
        });
      }
    }

    if (citedSources.length === 0 && sources.length > 0) {
      citedSources.push(...sources.slice(0, 3));
    }

    return {
      response: cleanedResponse,
      citedSources,
      chartConfig,
    };
  } catch (error) {
    log("Chat error", { error: String(error) });
    throw error;
  }
}

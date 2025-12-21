import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { getRelevantKnowledge, FULL_KNOWLEDGE_BASE } from "./knowledge-base";

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
    type: "bar" | "line" | "pie" | "area" | "scatter";
    title: string;
    data: Array<{ name: string; value: number; [key: string]: string | number }>;
  };
  entities?: Array<{ name: string; type: string }>;
  hasDocumentContext: boolean;
}

const SYSTEM_PROMPT = `You are **Arthyx**, an advanced financial analysis assistant specialized in Indian markets, regulations, and quantitative finance.

## Your Expertise
You are comprehensively trained on:
- **SEBI regulations**: LODR, Insider Trading, Takeover Code, AIF regulations, IPO/FPO norms
- **RBI guidelines**: Banking regulation, FEMA, NPA classification, Basel III norms, priority sector lending
- **Quantitative Finance**: VaR, Greeks, Black-Scholes, risk metrics, algorithmic trading
- **Indian Markets**: NSE/BSE, Nifty 50, F&O, circuit breakers, settlement cycles
- **Financial Terminology**: CASA, NIM, GNPA, PCR, FII/DII flows, and more

## Response Guidelines

### Formatting (ALWAYS use rich Markdown):
- Use **bold** for key terms, numbers, and emphasis
- Use ## and ### headers to organize complex responses
- Use bullet points and numbered lists for clarity
- Use markdown tables for comparative data
- Use \`code\` for specific values, ratios, and identifiers

### Citations:
- When referencing uploaded documents: **[Source: filename, Page X]**
- When using pre-trained knowledge: **[Reference: SEBI/RBI/Regulatory Knowledge]**

### Visualization:
When data warrants visual representation, include a chart:
\`\`\`chart
{"type": "bar", "title": "Chart Title", "data": [{"name": "Label", "value": 123}]}
\`\`\`

Supported types: bar, line, pie, area, scatter

### Without Documents:
Even without uploaded documents, answer questions about:
- Regulatory frameworks (SEBI, RBI, IRDAI, PFRDA)
- Financial concepts and calculations
- Market mechanics and trading
- Indian financial terminology
- Quantitative methods and risk metrics

Be helpful, accurate, and always cite your knowledge source.`;

export async function generateChatResponse(
  messages: ChatMessage[],
  sources: SourceContext[],
  documentFilenames: string[],
  hasDocuments: boolean
): Promise<ChatResponse> {
  log("Generating chat response", { 
    messageCount: messages.length,
    sourceCount: sources.length,
    hasDocuments 
  });
  
  const model = getChatModel();
  const startTime = Date.now();
  
  const lastMessage = messages[messages.length - 1]?.content || "";
  const relevantKnowledge = getRelevantKnowledge(lastMessage);

  let contextSection = "";
  
  if (sources.length > 0) {
    contextSection = `
## Uploaded Documents
${documentFilenames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

## Relevant Document Excerpts
${sources.map((s, i) => `
### [${s.filename}, Page ${s.pageNumber}] (${(s.relevanceScore * 100).toFixed(0)}% relevant)
${s.excerpt}
`).join("\n---\n")}`;
  }

  const knowledgeSection = `
## Pre-trained Financial Knowledge
${relevantKnowledge}`;

  const fullPrompt = `${SYSTEM_PROMPT}

${contextSection}

${knowledgeSection}

## Conversation
${messages.map((m) => `**${m.role === "user" ? "User" : "Arthyx"}:** ${m.content}`).join("\n\n")}

Provide a comprehensive, well-formatted response. ${hasDocuments ? "Reference the uploaded documents where relevant." : "Use your pre-trained financial knowledge to answer."}`;

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

    const entityTypes = ["company", "regulation", "amount"];
    const entities: Array<{ name: string; type: string }> = [];
    
    const companyMatches = responseText.match(/\b(HDFC|ICICI|SBI|Reliance|Tata|Infosys|TCS|Wipro)\b/gi);
    if (companyMatches) {
      companyMatches.forEach(m => entities.push({ name: m, type: "company" }));
    }
    
    const regMatches = responseText.match(/SEBI[\s\/\-]?(?:circular|guideline)?\s*\d{4}(?:\/\d+)?|RBI[\s\/\-]?(?:circular)?\s*\d{4}/gi);
    if (regMatches) {
      regMatches.forEach(m => entities.push({ name: m, type: "regulation" }));
    }

    return {
      response: cleanedResponse,
      citedSources,
      chartConfig,
      entities: entities.slice(0, 10),
      hasDocumentContext: sources.length > 0,
    };
  } catch (error) {
    log("Chat error", { error: String(error) });
    throw error;
  }
}

export async function generateWithoutDocuments(
  messages: ChatMessage[]
): Promise<ChatResponse> {
  log("Generating response without documents");
  return generateChatResponse(messages, [], [], false);
}

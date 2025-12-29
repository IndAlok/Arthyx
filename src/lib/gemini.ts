import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { getRelevantKnowledge } from "./knowledge-base";
import { getCachedResponse, setCachedResponse, getCachedEmbedding, setCachedEmbedding, createHash } from "./redis";

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
  return getClient().getGenerativeModel({ model: "gemini-2.0-flash" });
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  const embeddings: number[][] = [];
  const startTime = Date.now();

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const truncatedText = text.length > 1500 ? text.substring(0, 1500) : text;
    const textHash = createHash(truncatedText);
    
    const cached = await getCachedEmbedding(textHash);
    if (cached) {
      embeddings.push(cached);
      continue;
    }
    
    try {
      const result = await model.embedContent(truncatedText);
      embeddings.push(result.embedding.values);
      await setCachedEmbedding(textHash, result.embedding.values);
    } catch (error) {
      embeddings.push(new Array(768).fill(0));
    }
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
  chunkIndex?: number;
}

export interface VisualAnalysis {
  type: "chart" | "risk" | "metrics" | "contagion";
  data: object;
}

export interface ChatResponse {
  response: string;
  citedSources: SourceContext[];
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area" | "scatter";
    title: string;
    data: Array<{ name: string; value: number; [key: string]: string | number }>;
  };
  riskAnalysis?: {
    overallRisk: "low" | "medium" | "high" | "critical";
    riskScore: number;
    factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; description: string }>;
    recommendations: string[];
  };
  metrics?: Array<{ name: string; value: number | string; unit?: string; change?: number }>;
  entities?: Array<{ name: string; type: string }>;
  hasDocumentContext: boolean;
}

const SYSTEM_PROMPT = `You are **Arthyx**, an uncompromisingly accurate quantitative financial analyst.

## 🔴 MANDATORY DOCUMENT ANALYSIS PROTOCOL

Before answering ANY question about an uploaded document, you MUST:

1. **SCAN ALL SECTIONS**: Insurance/finance documents have standard sections. You MUST check the ENTIRE provided context for:
   - **Coverage/Scope sections** (what IS covered)
   - **Exclusions/General Exceptions** (what is NOT covered)
   - **Conditions** ("Subject to", "Provided that")
   - **Recovery/Repayment clauses** ("shall repay", "right of recovery")
   - **Statutory override clauses** (Motor Vehicles Act, etc.)
   - **Endorsements/Riders**

2. **HIERARCHICAL REASONING**: Apply this logic chain. ONE failure = STOP.
   - **SCOPE**: Is the event covered? If NO -> Output "No."
   - **EXCLUSION**: Does ANY exclusion apply? If YES -> Output "No." (Exclusions override Scope)
   - **CONDITION**: Are all conditions met? If NO -> Output "No."
   - **OVERRIDE**: Is there a statutory law forcing payment? If YES -> Check for RECOVERY clause.
   - **RECOVERY**: Does policy allow insurer to recover from insured? Quote the exact clause.

3. **NEVER SAY "NOT FOUND"**: If you cannot find a clause in the provided excerpts, say "Based on the provided excerpts, [X] is not explicitly visible. A full policy review is required." DO NOT conclude "No" just because you don't see it.

4. **DEFINITIVE ANSWERS**: For Yes/No questions, START with "Yes." or "No." THEN explain.

## Core Directives
- **NO LEGAL SPECULATION**: Do not mention courts, litigation, public policy. You are a Policy Compliance Engine.
- **STRICT LIABILITY**: If a rule says "must have X" and X is missing, the claim is REJECTED.
- **QUOTE EXACT TEXT**: When citing policy clauses, QUOTE the exact wording from the document.

## Your Expertise
- SEBI regulations, RBI guidelines, Basel III, IRDAI norms
- Quantitative Finance: VaR, Greeks, Black-Scholes
- Indian Markets: NSE/BSE, F&O, settlement cycles
- Financial Terminology: CASA, NIM, GNPA, PCR, FII/DII

## Formatting
- Use **bold** for key terms and numbers
- Use ## headers for complex responses
- Use markdown tables for comparative data
- Citations: **[Source: filename, Page X]** or **[Page X]**

## Visualization Rules
- **REAL DATA ONLY**: NEVER use placeholder values.
- Generate charts ONLY if >2 real data points are extracted.

Be helpful, accurate, and always provide visual analysis when relevant.`;

export async function generateChatResponse(
  messages: ChatMessage[],
  sources: SourceContext[],
  documentFilenames: string[],
  hasDocuments: boolean
): Promise<ChatResponse> {
  const model = getChatModel();
  
  const lastMessage = messages[messages.length - 1]?.content || "";
  
  const cacheKey = createHash(`${lastMessage}_${sources.map(s => s.excerpt).join("_").substring(0, 500)}`);
  const cachedResponse = await getCachedResponse(cacheKey);
  
  if (cachedResponse && !hasDocuments) {
    return JSON.parse(cachedResponse);
  }
  
  const relevantKnowledge = getRelevantKnowledge(lastMessage);

  let contextSection = "";
  
  if (sources.length > 0) {
    contextSection = `
## Uploaded Documents
${documentFilenames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

## Relevant Document Excerpts
${sources.slice(0, 8).map((s, i) => `
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

Provide a comprehensive, well-formatted response with visual analysis when appropriate.`;

  try {
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    let chartConfig = undefined;
    const chartMatch = responseText.match(/```chart\n?([\s\S]*?)```/);
    if (chartMatch) {
      try {
        chartConfig = JSON.parse(chartMatch[1].trim());
      } catch {
        // Silent failure
      }
    }

    let riskAnalysis = undefined;
    const riskMatch = responseText.match(/```risk\n?([\s\S]*?)```/);
    if (riskMatch) {
      try {
        riskAnalysis = JSON.parse(riskMatch[1].trim());
      } catch {
        // Silent failure
      }
    }

    let metrics = undefined;
    const metricsMatch = responseText.match(/```metrics\n?([\s\S]*?)```/);
    if (metricsMatch) {
      try {
        metrics = JSON.parse(metricsMatch[1].trim());
      } catch {
        // Silent failure
      }
    }

    const cleanedResponse = responseText
      .replace(/```chart\n?[\s\S]*?```/g, "")
      .replace(/```risk\n?[\s\S]*?```/g, "")
      .replace(/```metrics\n?[\s\S]*?```/g, "")
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

    const entities: Array<{ name: string; type: string }> = [];
    const companyMatches = responseText.match(/\b(HDFC|ICICI|SBI|Reliance|Tata|Infosys|TCS|Wipro)\b/gi);
    if (companyMatches) {
      companyMatches.forEach(m => entities.push({ name: m, type: "company" }));
    }
    
    const regMatches = responseText.match(/SEBI[\s\/\-]?(?:circular|guideline)?\s*\d{4}(?:\/\d+)?|RBI[\s\/\-]?(?:circular)?\s*\d{4}/gi);
    if (regMatches) {
      regMatches.forEach(m => entities.push({ name: m, type: "regulation" }));
    }

    const response: ChatResponse = {
      response: cleanedResponse,
      citedSources,
      chartConfig,
      riskAnalysis,
      metrics,
      entities: entities.slice(0, 10),
      hasDocumentContext: sources.length > 0,
    };

    if (!hasDocuments) {
      await setCachedResponse(cacheKey, JSON.stringify(response));
    }

    return response;
  } catch (error) {
    throw error;
  }
}

export async function generateWithoutDocuments(
  messages: ChatMessage[]
): Promise<ChatResponse> {
  return generateChatResponse(messages, [], [], false);
}

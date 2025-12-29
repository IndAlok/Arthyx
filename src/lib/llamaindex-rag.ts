import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

export interface RAGQueryResult {
  response: string;
  sources: RAGSource[];
  confidence: number;
}

export interface RAGSource {
  pageNumber: number;
  text: string;
  score: number;
  type: "text" | "table";
}

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getPineconeClient() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY not configured");
  return new Pinecone({ apiKey });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function queryWithLlamaIndex(
  query: string,
  sessionId: string,
  options: { topK?: number; includeMetadata?: boolean } = {}
): Promise<RAGQueryResult> {
  const { topK = 15, includeMetadata = true } = options;
  const startTime = Date.now();

  try {
    const queryEmbedding = await generateEmbedding(query);

    const pinecone = getPineconeClient();
    const index = pinecone.index("arthyx");

    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata,
      filter: { sessionId: { $eq: sessionId } },
    });

    const sources: RAGSource[] = queryResponse.matches?.map(match => ({
      pageNumber: (match.metadata?.pageNumber as number) || 0,
      text: (match.metadata?.text as string) || "",
      score: match.score || 0,
      type: ((match.metadata?.type as string) || "text") as "text" | "table",
    })) || [];

    if (sources.length === 0) {
      return {
        response: "",
        sources: [],
        confidence: 0,
      };
    }

    const context = sources
      .map((s, i) => `[Source ${i + 1}, Page ${s.pageNumber}]:\n${s.text}`)
      .join("\n\n");

    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const systemPrompt = `You are **Arthyx**, an uncompromisingly accurate quantitative financial analyst.

    CORE DIRECTIVES:
    1. **BINARY LOGIC GATES**: Treat phrases like "subject to", "provided that", "exclusion", and "condition" as **HARD LOGIC GATES**. If a condition is unmet, the outcome is definitively **NEGATIVE**. Do not hedge.
    2. **NO LEGAL SPECULATION**: Do not mention "courts", "litigation", "public policy", "sympathetic interpretation", or "debatable". You are a **Policy Compliance Engine**, not a lawyer.
    3. **DEFINITIVE ANSWERS**: For Yes/No questions, START your response with **"Yes."** or **"No."**.
    4. **STRICT LIABILITY**: In insurance/finance, if a rule says "must have X" and X is missing, the claim/transaction is **REJECTED**. No exceptions unless explicitly stated in the text.

    CONTEXT GUIDELINES:
    1. The context provided below contains raw text extractions from PDFs. 
    2. Ignore artifacts like "=== BATCH X ===" or "Markdown | Format". Focus on the content.
    3. You have access to distinct chunks from various pages (e.g. [Page X]). Synthesize them into a complete answer.

    ANSWERING RULES:
    1. **HIERARCHY FIRST**: Check Exclusions -> Conditions -> Scope. If Exclusion/Condition fails, Scope is irrelevant.
    2. **Synthesize**: Don't just quote chunks. Combine information from multiple pages to tell the full story.
    3. **Precision**: Quote exact numbers, ratios, and dates.
    4. **Citations**: STRICTLY format citations as **[Page X]**. Do not use "Source 1".
    5. **Tone**: Professional, objective, for quantitative analysts.
    6. **Tables**: If data is tabular, output clean Markdown tables.

    ## 🛑 STRICT REASONING PROTOCOL
    - **Exclusions** are HARD STOPS.
    - **Conditions** ("Subject to") are HARD STOPS.
    - **Statutory Overrides** (Motor Vehicles Act) mean PAY & RECOVER.
    - **Visuals**: REAL DATA ONLY. No placeholders.

    CONTEXT FROM DOCUMENTS:
    ${context}

    USER QUESTION: ${query}`;

    const result = await model.generateContent(systemPrompt);
    const response = result.response.text();

    const avgScore = sources.length > 0 
      ? sources.reduce((sum, s) => sum + s.score, 0) / sources.length 
      : 0;

    return {
      response,
      sources,
      confidence: avgScore,
    };
  } catch (error) {
    return {
      response: "",
      sources: [],
      confidence: 0,
    };
  }
}

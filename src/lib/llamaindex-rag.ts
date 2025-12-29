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
  const { topK = 30, includeMetadata = true } = options;
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

    ## 🔴 MANDATORY DOCUMENT ANALYSIS PROTOCOL

    Before answering ANY question, you MUST:

    1. **SCAN ALL SECTIONS**: Insurance/finance documents have standard sections. Check the ENTIRE provided context for:
       - **Coverage/Scope** (what IS covered)
       - **Exclusions/General Exceptions** (what is NOT covered)
       - **Conditions** ("Subject to", "Provided that")
       - **Recovery/Repayment clauses** ("shall repay", "right of recovery")
       - **Statutory override clauses** (Motor Vehicles Act, etc.)
       - **Endorsements/Riders**

    2. **HIERARCHICAL REASONING**: Apply this logic chain. ONE failure = STOP.
       - **SCOPE**: Is the event covered? If NO -> Output "No."
       - **EXCLUSION**: Does ANY exclusion apply? If YES -> Output "No."
       - **CONDITION**: Are all conditions met? If NO -> Output "No."
       - **OVERRIDE**: Is there a statutory law forcing payment? If YES -> Check for RECOVERY clause.
       - **RECOVERY**: Does policy allow insurer to recover? Quote the exact clause.

    3. **NEVER SAY "NOT FOUND" AS CONCLUSION**: If you cannot find a clause, say "Based on the provided excerpts, [X] is not explicitly visible." DO NOT conclude "No" just because you don't see it.

    4. **DEFINITIVE ANSWERS**: For Yes/No questions, START with "Yes." or "No." THEN explain.

    5. **QUOTE EXACT TEXT**: When citing policy clauses, QUOTE the exact wording from the context.

    ## Core Rules
    - **NO LEGAL SPECULATION**: Do not mention courts, litigation, public policy.
    - **STRICT LIABILITY**: If a rule says "must have X" and X is missing, claim is REJECTED.
    - **Citations**: Format as **[Page X]**. Do not use "Source 1".
    - **Tables**: If data is tabular, output clean Markdown tables.

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

import { getSessionGraph, queryRiskContagion, Entity, Relationship } from "./neo4j";

export interface RiskNode {
  id: string;
  name: string;
  type: "company" | "regulation" | "sector" | "risk";
  riskScore?: number;
  connections: number;
}

export interface RiskEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface RiskAnalysis {
  overallRisk: "low" | "medium" | "high" | "critical";
  riskScore: number;
  factors: Array<{
    factor: string;
    impact: "positive" | "negative" | "neutral";
    description: string;
  }>;
  contagionPaths: Array<{
    path: string[];
    probability: number;
  }>;
  recommendations: string[];
}

export interface ContagionSimulation {
  sourceEntity: string;
  affectedEntities: Array<{
    name: string;
    impactLevel: number;
    hops: number;
  }>;
  totalExposure: number;
  systemicRisk: boolean;
}

const INDIAN_BANKS = [
  "SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra",
  "Yes Bank", "IndusInd Bank", "RBL Bank", "Bandhan Bank", "IDFC First"
];

const INDIAN_SECTORS = [
  "Banking", "IT Services", "Pharmaceuticals", "Automobiles", 
  "Telecom", "FMCG", "Energy", "Infrastructure", "Real Estate"
];

export function calculateVaR(
  returns: number[],
  confidence: number = 0.95,
  portfolioValue: number = 1000000
): { var: number; method: string; confidence: number } {
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  const varPercent = sorted[index] || 0;
  
  return {
    var: Math.abs(varPercent * portfolioValue),
    method: "Historical",
    confidence,
  };
}

export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0.06
): number {
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev > 0 ? (avgReturn - riskFreeRate / 252) / stdDev : 0;
}

export function extractFinancialMetrics(text: string): {
  amounts: Array<{ value: number; currency: string; context: string }>;
  percentages: Array<{ value: number; context: string }>;
  ratios: Array<{ name: string; value: number }>;
} {
  const amounts: Array<{ value: number; currency: string; context: string }> = [];
  const percentages: Array<{ value: number; context: string }> = [];
  const ratios: Array<{ name: string; value: number }> = [];

  const amountPatterns = [
    { regex: /₹\s*([\d,]+(?:\.\d+)?)\s*(crore|lakh|million|billion)?/gi, currency: "INR" },
    { regex: /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*(crore|lakh|million|billion)?/gi, currency: "INR" },
    { regex: /INR\s*([\d,]+(?:\.\d+)?)\s*(crore|lakh|million|billion)?/gi, currency: "INR" },
    { regex: /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion)?/gi, currency: "USD" },
  ];

  for (const { regex, currency } of amountPatterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = parseFloat(match[1].replace(/,/g, ""));
      const multiplier = match[2]?.toLowerCase();
      let finalValue = value;
      
      if (multiplier === "crore") finalValue *= 10000000;
      else if (multiplier === "lakh") finalValue *= 100000;
      else if (multiplier === "million") finalValue *= 1000000;
      else if (multiplier === "billion") finalValue *= 1000000000;
      
      const context = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
      amounts.push({ value: finalValue, currency, context: context.trim() });
    }
  }

  const percentMatch = text.matchAll(/(\d+(?:\.\d+)?)\s*%/g);
  for (const match of percentMatch) {
    const context = text.substring(Math.max(0, match.index! - 30), match.index! + match[0].length + 30);
    percentages.push({ value: parseFloat(match[1]), context: context.trim() });
  }

  const ratioPatterns = [
    { name: "P/E Ratio", regex: /P\/E\s*(?:ratio)?\s*[:\-]?\s*([\d.]+)/i },
    { name: "Debt/Equity", regex: /Debt\s*(?:to)?\s*Equity\s*[:\-]?\s*([\d.]+)/i },
    { name: "ROE", regex: /ROE\s*[:\-]?\s*([\d.]+)%?/i },
    { name: "ROA", regex: /ROA\s*[:\-]?\s*([\d.]+)%?/i },
    { name: "NIM", regex: /NIM\s*[:\-]?\s*([\d.]+)%?/i },
    { name: "CAR", regex: /CAR\s*[:\-]?\s*([\d.]+)%?/i },
    { name: "GNPA", regex: /GNPA\s*[:\-]?\s*([\d.]+)%?/i },
    { name: "NNPA", regex: /NNPA\s*[:\-]?\s*([\d.]+)%?/i },
  ];

  for (const { name, regex } of ratioPatterns) {
    const match = text.match(regex);
    if (match) {
      ratios.push({ name, value: parseFloat(match[1]) });
    }
  }

  return { amounts, percentages, ratios };
}

export async function simulateRiskContagion(
  sessionId: string,
  sourceEntity: string,
  shockMagnitude: number = 0.1
): Promise<ContagionSimulation> {
  const paths = await queryRiskContagion(sessionId, sourceEntity, 3);
  
  const affectedEntities: Array<{ name: string; impactLevel: number; hops: number }> = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (let i = 1; i < path.path.length; i++) {
      const entity = path.path[i];
      if (!seen.has(entity) && entity !== sourceEntity) {
        seen.add(entity);
        const decay = Math.pow(0.6, i);
        affectedEntities.push({
          name: entity,
          impactLevel: shockMagnitude * decay,
          hops: i,
        });
      }
    }
  }

  affectedEntities.sort((a, b) => b.impactLevel - a.impactLevel);

  const totalExposure = affectedEntities.reduce((sum, e) => sum + e.impactLevel, 0);
  const systemicRisk = affectedEntities.length > 5 || totalExposure > 0.3;

  return {
    sourceEntity,
    affectedEntities: affectedEntities.slice(0, 10),
    totalExposure,
    systemicRisk,
  };
}

export function generateRiskReport(
  metrics: ReturnType<typeof extractFinancialMetrics>,
  entities: Entity[]
): RiskAnalysis {
  const factors: RiskAnalysis["factors"] = [];
  let riskScore = 50;

  const gnpa = metrics.ratios.find(r => r.name === "GNPA");
  if (gnpa) {
    if (gnpa.value > 5) {
      factors.push({ factor: "High GNPA", impact: "negative", description: `GNPA at ${gnpa.value}% exceeds RBI threshold` });
      riskScore += 15;
    } else if (gnpa.value < 2) {
      factors.push({ factor: "Low GNPA", impact: "positive", description: `GNPA at ${gnpa.value}% indicates healthy assets` });
      riskScore -= 10;
    }
  }

  const car = metrics.ratios.find(r => r.name === "CAR");
  if (car) {
    if (car.value < 9) {
      factors.push({ factor: "Low CAR", impact: "negative", description: `CAR at ${car.value}% below Basel III minimum` });
      riskScore += 20;
    } else if (car.value > 12) {
      factors.push({ factor: "Strong CAR", impact: "positive", description: `CAR at ${car.value}% indicates strong capital` });
      riskScore -= 10;
    }
  }

  const regulations = entities.filter(e => e.type === "regulation");
  if (regulations.length > 0) {
    factors.push({ 
      factor: "Regulatory Framework", 
      impact: "neutral", 
      description: `Document references ${regulations.length} regulatory citations` 
    });
  }

  const overallRisk: RiskAnalysis["overallRisk"] = 
    riskScore > 75 ? "critical" : 
    riskScore > 60 ? "high" : 
    riskScore > 40 ? "medium" : "low";

  const recommendations = [];
  if (riskScore > 60) {
    recommendations.push("Consider diversifying exposure across sectors");
    recommendations.push("Review NPA provisioning adequacy");
  }
  if (gnpa && gnpa.value > 3) {
    recommendations.push("Strengthen asset quality monitoring");
  }

  return {
    overallRisk,
    riskScore: Math.min(100, Math.max(0, riskScore)),
    factors,
    contagionPaths: [],
    recommendations,
  };
}

export function generateAlphaSignals(
  metrics: ReturnType<typeof extractFinancialMetrics>,
  sectorContext: string
): Array<{ signal: string; strength: "weak" | "moderate" | "strong"; rationale: string }> {
  const signals: Array<{ signal: string; strength: "weak" | "moderate" | "strong"; rationale: string }> = [];

  const roe = metrics.ratios.find(r => r.name === "ROE");
  if (roe && roe.value > 15) {
    signals.push({
      signal: "Long",
      strength: "moderate",
      rationale: `ROE of ${roe.value}% suggests efficient capital utilization`,
    });
  }

  const pe = metrics.ratios.find(r => r.name === "P/E Ratio");
  if (pe && pe.value < 15) {
    signals.push({
      signal: "Value Opportunity",
      strength: "weak",
      rationale: `P/E of ${pe.value} may indicate undervaluation`,
    });
  }

  const debtEquity = metrics.ratios.find(r => r.name === "Debt/Equity");
  if (debtEquity && debtEquity.value < 0.5) {
    signals.push({
      signal: "Low Leverage Advantage",
      strength: "moderate",
      rationale: `D/E of ${debtEquity.value} provides financial flexibility`,
    });
  }

  return signals;
}

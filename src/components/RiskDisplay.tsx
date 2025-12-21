"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Shield, TrendingUp, TrendingDown, Target, Zap } from "lucide-react";

interface RiskFactor {
  factor: string;
  impact: "positive" | "negative" | "neutral";
  description: string;
}

interface RiskDisplayProps {
  overallRisk: "low" | "medium" | "high" | "critical";
  riskScore: number;
  factors: RiskFactor[];
  recommendations?: string[];
}

const riskColors = {
  low: { bg: "from-emerald-500/20 to-green-500/20", text: "text-emerald-400", bar: "bg-emerald-500" },
  medium: { bg: "from-yellow-500/20 to-amber-500/20", text: "text-yellow-400", bar: "bg-yellow-500" },
  high: { bg: "from-orange-500/20 to-red-500/20", text: "text-orange-400", bar: "bg-orange-500" },
  critical: { bg: "from-red-500/20 to-rose-500/20", text: "text-red-400", bar: "bg-red-500" },
};

export default function RiskDisplay({ overallRisk, riskScore, factors, recommendations }: RiskDisplayProps) {
  const colors = riskColors[overallRisk];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.bg} flex items-center justify-center`}>
            {overallRisk === "low" || overallRisk === "medium" ? (
              <Shield className={`w-6 h-6 ${colors.text}`} />
            ) : (
              <AlertTriangle className={`w-6 h-6 ${colors.text}`} />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Risk Assessment</h3>
            <p className={`text-sm ${colors.text} capitalize font-medium`}>{overallRisk} Risk</p>
          </div>
        </div>
        
        <div className="text-right">
          <div className={`text-3xl font-bold ${colors.text}`}>{riskScore}</div>
          <div className="text-xs text-slate-400">/ 100</div>
        </div>
      </div>

      <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${riskScore}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full ${colors.bar}`}
        />
      </div>

      {factors.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-300">Key Factors</h4>
          <div className="space-y-2">
            {factors.map((factor, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-start gap-3 p-2 rounded-lg bg-slate-700/30"
              >
                {factor.impact === "positive" ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                ) : factor.impact === "negative" ? (
                  <TrendingDown className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <Target className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <div className="text-sm font-medium text-white">{factor.factor}</div>
                  <div className="text-xs text-slate-400">{factor.description}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {recommendations && recommendations.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-700/50">
          <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            Recommendations
          </h4>
          <ul className="space-y-1">
            {recommendations.map((rec, i) => (
              <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                <span className="text-emerald-400">•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

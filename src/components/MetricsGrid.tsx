"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";

interface FinancialMetric {
  name: string;
  value: number | string;
  unit?: string;
  change?: number;
  benchmark?: string;
}

interface MetricsGridProps {
  metrics: FinancialMetric[];
  title?: string;
}

export default function MetricsGrid({ metrics, title = "Key Metrics" }: MetricsGridProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.name}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="p-3 rounded-xl bg-slate-700/30 border border-slate-700/50 hover:border-slate-600/50 transition-colors"
          >
            <div className="text-xs text-slate-400 mb-1">{metric.name}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-white">
                {typeof metric.value === "number" 
                  ? metric.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                  : metric.value}
              </span>
              {metric.unit && (
                <span className="text-xs text-slate-400">{metric.unit}</span>
              )}
            </div>
            
            {metric.change !== undefined && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${
                metric.change > 0 ? "text-emerald-400" : 
                metric.change < 0 ? "text-red-400" : "text-slate-400"
              }`}>
                {metric.change > 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : metric.change < 0 ? (
                  <TrendingDown className="w-3 h-3" />
                ) : (
                  <Minus className="w-3 h-3" />
                )}
                <span>{Math.abs(metric.change).toFixed(1)}%</span>
              </div>
            )}
            
            {metric.benchmark && (
              <div className="text-xs text-slate-500 mt-1">
                vs {metric.benchmark}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

"use client";

import { motion } from "framer-motion";
import { Network, AlertCircle, ArrowRight, Zap } from "lucide-react";

interface ContagionNode {
  name: string;
  impactLevel: number;
  hops: number;
}

interface ContagionGraphProps {
  sourceEntity: string;
  affectedEntities: ContagionNode[];
  totalExposure: number;
  systemicRisk: boolean;
}

export default function ContagionGraph({ 
  sourceEntity, 
  affectedEntities, 
  totalExposure, 
  systemicRisk 
}: ContagionGraphProps) {
  const maxImpact = Math.max(...affectedEntities.map(e => e.impactLevel), 0.1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
            <Network className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Risk Contagion</h3>
            <p className="text-sm text-slate-400">Impact propagation from {sourceEntity}</p>
          </div>
        </div>
        
        {systemicRisk && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-red-500/20 border border-red-500/30">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-400 font-medium">Systemic Risk</span>
          </div>
        )}
      </div>

      <div className="relative py-6">
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-purple-500 via-pink-500 to-orange-500 opacity-30" />
        
        <div className="flex items-center gap-3 mb-6">
          <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <div>
            <div className="text-white font-semibold">{sourceEntity}</div>
            <div className="text-xs text-slate-400">Source of shock</div>
          </div>
        </div>

        <div className="space-y-3 ml-4">
          {affectedEntities.map((entity, i) => (
            <motion.div
              key={entity.name}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-2 text-slate-500">
                {Array.from({ length: entity.hops }).map((_, j) => (
                  <ArrowRight key={j} className="w-3 h-3" />
                ))}
              </div>
              
              <div 
                className="flex-1 flex items-center justify-between p-3 rounded-lg border transition-all"
                style={{
                  backgroundColor: `rgba(239, 68, 68, ${entity.impactLevel * 0.3})`,
                  borderColor: `rgba(239, 68, 68, ${entity.impactLevel * 0.5})`,
                }}
              >
                <div>
                  <div className="text-white font-medium">{entity.name}</div>
                  <div className="text-xs text-slate-400">{entity.hops} hop(s) away</div>
                </div>
                
                <div className="text-right">
                  <div className="text-lg font-bold text-red-400">
                    {(entity.impactLevel * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-400">Impact</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
        <div>
          <div className="text-sm text-slate-400">Total Exposure</div>
          <div className="text-xl font-bold text-white">{(totalExposure * 100).toFixed(1)}%</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-400">Affected Entities</div>
          <div className="text-xl font-bold text-white">{affectedEntities.length}</div>
        </div>
      </div>
    </motion.div>
  );
}

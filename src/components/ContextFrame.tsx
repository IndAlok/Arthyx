"use client";

import { motion, AnimatePresence } from "framer-motion";
import { FileText, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SourceContextData {
  filename: string;
  pageNumber: number;
  excerpt: string;
  relevanceScore?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface ContextFrameProps {
  sources: SourceContextData[];
  onClose?: () => void;
  className?: string;
}

export default function ContextFrame({ sources, onClose, className }: ContextFrameProps) {
  if (sources.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        "bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl",
        "rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-medium text-white">Referenced Context</span>
          <span className="text-xs text-slate-500">({sources.length} sources)</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        <AnimatePresence>
          {sources.map((source, index) => (
            <motion.div
              key={`${source.filename}-${source.pageNumber}-${index}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative group"
            >
              <div className="absolute -left-1 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
              
              <div className="ml-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/30 hover:border-emerald-500/30 transition-all">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-emerald-400">
                        {source.filename}
                      </span>
                      <span className="text-xs text-slate-500 ml-2">
                        Page {source.pageNumber}
                      </span>
                    </div>
                  </div>
                  
                  {source.relevanceScore !== undefined && (
                    <div className="flex items-center gap-1">
                      <div
                        className="h-1.5 rounded-full bg-slate-700 overflow-hidden"
                        style={{ width: "40px" }}
                      >
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                          style={{ width: `${source.relevanceScore * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">
                        {(source.relevanceScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    <span className="text-emerald-400/60">&ldquo;</span>
                    {source.excerpt}
                    <span className="text-emerald-400/60">&rdquo;</span>
                  </p>
                  
                  {source.boundingBox && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                      <ExternalLink className="w-3 h-3" />
                      <span>
                        Position: {source.boundingBox.x.toFixed(0)}%, {source.boundingBox.y.toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="px-4 py-2 border-t border-slate-700/50 bg-slate-800/30">
        <p className="text-xs text-slate-500 text-center">
          Sources are ranked by semantic relevance to your query
        </p>
      </div>
    </motion.div>
  );
}

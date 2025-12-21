"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SourceData {
  filename: string;
  pageNumber: number;
  excerpt: string;
  relevanceScore?: number;
}

interface SourceModalProps {
  sources: SourceData[];
  isOpen: boolean;
  onClose: () => void;
}

export default function SourceModal({ sources, isOpen, onClose }: SourceModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          
          <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-4 top-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] max-h-[80vh] z-50"
          >
            <div className="bg-gradient-to-br from-slate-800 via-slate-850 to-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl shadow-black/50 overflow-hidden">
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-slate-700/50 bg-gradient-to-r from-slate-800 to-slate-900">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Source Context</h3>
                    <p className="text-xs text-slate-400">{sources.length} relevant excerpts</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                {sources.map((source, index) => (
                  <motion.div
                    key={`${source.filename}-${source.pageNumber}-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="relative group"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
                    
                    <div className="ml-4 p-4 rounded-xl bg-slate-800/60 border border-slate-700/30 hover:border-emerald-500/30 transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium">
                            {source.filename}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 text-xs">
                            Page {source.pageNumber}
                          </span>
                        </div>
                        
                        {source.relevanceScore !== undefined && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="w-12 h-2 rounded-full bg-slate-700 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${source.relevanceScore * 100}%` }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                              />
                            </div>
                            <span className="text-xs text-emerald-400 font-medium">
                              {(source.relevanceScore * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <span className="absolute -left-2 top-0 text-2xl text-emerald-500/30 font-serif">"</span>
                        <p className="text-sm text-slate-300 leading-relaxed pl-3">
                          {source.excerpt}
                        </p>
                        <span className="absolute -right-1 bottom-0 text-2xl text-emerald-500/30 font-serif rotate-180">"</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="sticky bottom-0 px-5 py-3 border-t border-slate-700/50 bg-slate-900/90 backdrop-blur-sm">
                <p className="text-xs text-slate-500 text-center flex items-center justify-center gap-1">
                  <ExternalLink className="w-3 h-3" />
                  Sources ranked by semantic relevance to your query
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

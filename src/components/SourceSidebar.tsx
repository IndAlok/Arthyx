"use client";

import { motion } from "framer-motion";
import { FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Source {
  filename: string;
  pageNumber: number;
  excerpt?: string;
  score?: number;
}

interface SourceSidebarProps {
  sources: Source[];
  documents: string[];
  onSourceClick?: (source: Source) => void;
  isOpen: boolean;
}

export default function SourceSidebar({
  sources,
  documents,
  onSourceClick,
  isOpen,
}: SourceSidebarProps) {
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{
        width: isOpen ? 320 : 0,
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="h-full bg-gradient-to-b from-slate-900/80 to-slate-950/80 backdrop-blur-xl border-l border-slate-800/50 overflow-hidden"
    >
      <div className="w-80 h-full flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800/50">
          <h3 className="text-sm font-semibold text-white">Documents</h3>
          <p className="text-xs text-slate-500 mt-1">
            {documents.length} file(s) loaded
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {documents.length > 0 && (
            <div className="p-4 border-b border-slate-800/30">
              <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider">
                Uploaded Files
              </p>
              <div className="space-y-2">
                {documents.map((doc, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/30"
                  >
                    <FileText className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-sm text-slate-300 truncate">
                      {doc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="p-4">
              <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider">
                Referenced Sources
              </p>
              <div className="space-y-3">
                {sources.map((source, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    onClick={() => onSourceClick?.(source)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl bg-slate-800/40 border border-slate-700/30",
                      "hover:bg-slate-800/60 hover:border-emerald-500/30 transition-all group"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-emerald-400 truncate">
                          {source.filename}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Page {source.pageNumber}
                          {source.score && ` • ${(source.score * 100).toFixed(0)}% match`}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 transition-colors flex-shrink-0" />
                    </div>
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                      {source.excerpt}
                    </p>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {sources.length === 0 && documents.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-slate-500">
                Upload documents to see sources here
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

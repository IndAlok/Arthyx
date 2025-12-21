"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Sparkles, PanelRightOpen, PanelRightClose, Home } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import FileUpload from "@/components/FileUpload";
import SourceSidebar from "@/components/SourceSidebar";
import ChartRenderer from "@/components/ChartRenderer";

interface Source {
  filename: string;
  pageNumber: number;
  excerpt?: string;
  relevanceScore?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface ChartConfig {
  type: "bar" | "line" | "pie" | "area";
  title: string;
  data: Array<{ name: string; value: number }>;
}

export default function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleUploadComplete = (newSessionId: string, files: string[]) => {
    setSessionId(newSessionId);
    setDocuments((prev) => [...new Set([...prev, ...files])]);
  };

  const handleSourceClick = (source: { filename: string; pageNumber: number; excerpt?: string }) => {
    const fullSource: Source = {
      filename: source.filename,
      pageNumber: source.pageNumber,
      excerpt: source.excerpt || "",
    };
    setSources((prev) => {
      const exists = prev.some(
        (s) => s.filename === fullSource.filename && s.pageNumber === fullSource.pageNumber
      );
      if (exists) return prev;
      return [fullSource, ...prev].slice(0, 10);
    });
    if (!sidebarOpen) setSidebarOpen(true);
  };

  const handleChartData = (config: object) => {
    setChartConfig(config as ChartConfig);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800/50 glass">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">Arthyx</span>
            </Link>
            {sessionId && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400">
                  {documents.length} document(s) loaded
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
              title="Home"
            >
              <Home className="w-5 h-5 text-slate-400" />
            </Link>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? (
                <PanelRightClose className="w-5 h-5 text-slate-400" />
              ) : (
                <PanelRightOpen className="w-5 h-5 text-slate-400" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
          <motion.div
            layout
            className="flex-1 flex flex-col gap-4 min-w-0"
          >
            {!sessionId && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-6"
              >
                <FileUpload
                  onUploadComplete={handleUploadComplete}
                  sessionId={sessionId}
                />
              </motion.div>
            )}

            <motion.div
              layout
              className={`flex-1 min-h-[400px] ${sessionId ? "" : "opacity-50 pointer-events-none"}`}
            >
              <ChatInterface
                sessionId={sessionId}
                onSourceClick={handleSourceClick}
                onChartData={handleChartData}
              />
            </motion.div>

            {chartConfig && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <ChartRenderer config={chartConfig} />
              </motion.div>
            )}
          </motion.div>

          {sessionId && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:hidden glass rounded-2xl p-4"
            >
              <FileUpload
                onUploadComplete={handleUploadComplete}
                sessionId={sessionId}
              />
            </motion.div>
          )}
        </div>

        <SourceSidebar
          sources={sources}
          documents={documents}
          onSourceClick={handleSourceClick}
          isOpen={sidebarOpen}
        />
      </main>
    </div>
  );
}

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { PanelRightOpen, PanelRightClose, Home, Upload, FileText } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import FileUpload from "@/components/FileUpload";
import SourceSidebar from "@/components/SourceSidebar";
import ChartRenderer from "@/components/ChartRenderer";

interface Source {
  filename: string;
  pageNumber: number;
  excerpt?: string;
  relevanceScore?: number;
}

interface ChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  title: string;
  data: Array<{ name: string; value: number }>;
}

export default function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const handleUploadComplete = (newSessionId: string, files: string[]) => {
    setSessionId(newSessionId);
    setDocuments((prev) => [...new Set([...prev, ...files])]);
    setShowUpload(false);
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
            <Link href="/" className="flex items-center gap-3 group">
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="w-10 h-10 rounded-xl overflow-hidden"
              >
                <Image 
                  src="/logo.png" 
                  alt="Arthyx" 
                  width={40} 
                  height={40}
                  className="w-full h-full object-cover"
                />
              </motion.div>
              <span className="text-xl font-bold text-white">Arthyx</span>
            </Link>
            
            {sessionId && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400">
                  {documents.length} document(s) loaded
                </span>
              </motion.div>
            )}

            {!sessionId && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-800/50 border border-slate-700/50">
                <span className="text-xs text-slate-400">
                  Knowledge Mode (No docs required)
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {sessionId && (
              <button
                onClick={() => setShowUpload(!showUpload)}
                className={`p-2 rounded-lg transition-colors ${
                  showUpload 
                    ? "bg-emerald-500/20 text-emerald-400" 
                    : "hover:bg-slate-800/50 text-slate-400"
                }`}
                title="Upload more documents"
              >
                <Upload className="w-5 h-5" />
              </button>
            )}
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
            {(!sessionId || showUpload) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">
                        {sessionId ? "Add More Documents" : "Upload Documents (Optional)"}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {sessionId 
                          ? "Add more files to your current session"
                          : "Or start chatting immediately with our pre-trained knowledge"}
                      </p>
                    </div>
                  </div>
                  {showUpload && (
                    <button
                      onClick={() => setShowUpload(false)}
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <FileUpload
                  onUploadComplete={handleUploadComplete}
                  sessionId={sessionId}
                />
              </motion.div>
            )}

            <motion.div
              layout
              className="flex-1 min-h-[400px]"
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
                animate={{ opacity: 1, y: 0 satisfies number }}
              >
                <ChartRenderer config={chartConfig} />
              </motion.div>
            )}
          </motion.div>
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

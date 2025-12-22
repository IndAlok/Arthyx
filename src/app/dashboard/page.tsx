"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { PanelRightOpen, PanelRightClose, Home, Upload, FileText } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import FileUpload from "@/components/FileUpload";
import SourceSidebar from "@/components/SourceSidebar";

import CursorGlow from "@/components/CursorGlow";

interface Source {
  filename: string;
  pageNumber: number;
  excerpt?: string;
  relevanceScore?: number;
}



export default function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

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



  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
      <CursorGlow />
      
      <header className="px-6 py-4 border-b border-slate-800/50 glass relative z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3 group">
              <motion.div 
                whileHover={{ scale: 1.05, rotate: 5 }}
                whileTap={{ scale: 0.95 }}
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
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowUpload(!showUpload)}
                className={`p-2 rounded-lg transition-colors ${
                  showUpload 
                    ? "bg-emerald-500/20 text-emerald-400" 
                    : "hover:bg-slate-800/50 text-slate-400"
                }`}
                title="Upload more documents"
              >
                <Upload className="w-5 h-5" />
              </motion.button>
            )}
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Link
                href="/"
                className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors block"
                title="Home"
              >
                <Home className="w-5 h-5 text-slate-400" />
              </Link>
            </motion.div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? (
                <PanelRightClose className="w-5 h-5 text-slate-400" />
              ) : (
                <PanelRightOpen className="w-5 h-5 text-slate-400" />
              )}
            </motion.button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative z-10">
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
                    <motion.div 
                      whileHover={{ scale: 1.1, rotate: 10 }}
                      className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center"
                    >
                      <FileText className="w-5 h-5 text-emerald-400" />
                    </motion.div>
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
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setShowUpload(false)}
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </motion.button>
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
              />
            </motion.div>
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

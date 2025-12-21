"use client";

import { useState, useRef, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Sparkles, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";
import SourceModal, { SourceData } from "./SourceModal";
import ChartRenderer from "./ChartRenderer";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceData[];
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area";
    title: string;
    data: Array<{ name: string; value: number }>;
  };
}

interface ChatInterfaceProps {
  sessionId: string | null;
  onSourceClick?: (source: SourceData) => void;
  onChartData?: (config: object) => void;
}

export default function ChatInterface({
  sessionId,
  onChartData,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modalSources, setModalSources] = useState<SourceData[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const openSourceModal = (sources: SourceData[]) => {
    setModalSources(sources);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId || isLoading) return;

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content, sessionId }),
      });

      const data = await response.json();

      if (data.success) {
        const assistantMessage: Message = {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: data.response,
          sources: data.sources,
          chartConfig: data.chartConfig,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (data.chartConfig && onChartData) {
          onChartData(data.chartConfig);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `error_${Date.now()}`,
            role: "assistant",
            content: `**Error:** ${data.error || "Something went wrong"}`,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: "assistant",
          content: "**Error:** Failed to connect to the server. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full bg-gradient-to-b from-slate-900/50 to-slate-950/50 backdrop-blur-xl rounded-2xl border border-slate-800/50 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800/50 bg-slate-900/30">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Arthyx Assistant</h2>
            <p className="text-xs text-slate-400">Financial Document Intelligence</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center mb-4"
              >
                <Sparkles className="w-10 h-10 text-emerald-400" />
              </motion.div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Ready to Analyze
              </h3>
              <p className="text-slate-400 max-w-md text-sm">
                Upload financial documents and ask questions. I support PDF, Word, Excel, 
                images, and text files in multiple languages including Hindi, Tamil, Bengali, and Gujarati.
              </p>
            </div>
          )}

          <AnimatePresence>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-2"
              >
                <div
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-2xl",
                      message.role === "user"
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-3"
                        : "bg-slate-800/70 text-slate-100 px-4 py-3"
                    )}
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <MarkdownRenderer content={message.content} />
                    )}

                    {message.role === "assistant" && message.sources && message.sources.length > 0 && (
                      <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={() => openSourceModal(message.sources!)}
                        className="mt-3 pt-3 border-t border-slate-700/50 w-full flex items-center justify-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors group"
                      >
                        <BookOpen className="w-4 h-4 group-hover:scale-110 transition-transform" />
                        <span>View {message.sources.length} source(s)</span>
                      </motion.button>
                    )}
                  </div>
                </div>

                {message.chartConfig && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-4"
                  >
                    <ChartRenderer config={message.chartConfig} />
                  </motion.div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-slate-800/70 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="relative">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                  <div className="absolute inset-0 bg-emerald-400/20 rounded-full animate-ping" />
                </div>
                <span className="text-slate-400">Analyzing documents...</span>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-slate-800/50 bg-slate-900/30"
        >
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                sessionId
                  ? "Ask about your documents..."
                  : "Upload documents to start"
              }
              disabled={!sessionId || isLoading}
              className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3.5 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || !sessionId || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-emerald-500/20"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </form>
      </div>

      <SourceModal
        sources={modalSources}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}

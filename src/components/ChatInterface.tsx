"use client";

import { useState, useRef, FormEvent, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Sparkles, BookOpen, Edit3, X, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";
import SourceModal, { SourceData } from "./SourceModal";
import ChartRenderer from "./ChartRenderer";
import RiskDisplay from "./RiskDisplay";
import MetricsGrid from "./MetricsGrid";

interface RiskAnalysis {
  overallRisk: "low" | "medium" | "high" | "critical";
  riskScore: number;
  factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; description: string }>;
  recommendations?: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceData[];
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area" | "scatter";
    title: string;
    data: Array<{ name: string; value: number }>;
  };
  riskAnalysis?: RiskAnalysis;
  metrics?: Array<{ name: string; value: number | string; unit?: string; change?: number }>;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.setSelectionRange(
        editInputRef.current.value.length,
        editInputRef.current.value.length
      );
    }
  }, [editingId]);

  const openSourceModal = (sources: SourceData[]) => {
    setModalSources(sources);
    setIsModalOpen(true);
  };

  const startEditing = (message: Message) => {
    setEditingId(message.id);
    setEditContent(message.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent("");
  };

  const submitEdit = async (originalId: string) => {
    if (!editContent.trim() || isLoading) return;

    const editedContent = editContent.trim();
    setEditingId(null);
    setEditContent("");

    const messageIndex = messages.findIndex(m => m.id === originalId);
    if (messageIndex === -1) return;

    const newMessages = messages.slice(0, messageIndex);
    
    const newUserMessage: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      content: editedContent,
    };

    setMessages([...newMessages, newUserMessage]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: editedContent, 
          sessionId,
          isEdit: true,
          originalMessageId: originalId
        }),
      });

      const data = await response.json();

      if (data.success) {
        const assistantMessage: Message = {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: data.response,
          sources: data.sources,
          chartConfig: data.chartConfig,
          riskAnalysis: data.riskAnalysis,
          metrics: data.metrics,
        };

        setMessages([...newMessages, newUserMessage, assistantMessage]);

        if (data.chartConfig && onChartData) {
          onChartData(data.chartConfig);
        }
      }
    } catch {
      setMessages([...newMessages, newUserMessage, {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "**Error:** Failed to regenerate response.",
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

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
          riskAnalysis: data.riskAnalysis,
          metrics: data.metrics,
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
          content: "**Error:** Failed to connect. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const regenerateResponse = async (messageIndex: number) => {
    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") return;

    const newMessages = messages.slice(0, messageIndex);
    setMessages(newMessages);
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
          riskAnalysis: data.riskAnalysis,
          metrics: data.metrics,
        };

        setMessages([...newMessages, assistantMessage]);

        if (data.chartConfig && onChartData) {
          onChartData(data.chartConfig);
        }
      }
    } catch {
      setMessages([...newMessages, {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "**Error:** Failed to regenerate response.",
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full bg-gradient-to-b from-slate-900/50 to-slate-950/50 backdrop-blur-xl rounded-2xl border border-slate-800/50 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800/50 bg-slate-900/30">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-white">Arthyx Assistant</h2>
            <p className="text-xs text-slate-400">
              {sessionId ? "Document Analysis Mode" : "Financial Knowledge Mode"}
            </p>
          </div>
          {!sessionId && (
            <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-xs text-emerald-400">SEBI/RBI/Quant Knowledge</span>
            </div>
          )}
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
                {sessionId ? "Documents Ready" : "Ask Anything Financial"}
              </h3>
              <p className="text-slate-400 max-w-md text-sm mb-4">
                {sessionId 
                  ? "Your documents are loaded. Ask questions, request analysis, or generate visualizations."
                  : "Trained on SEBI, RBI, quantitative finance, and Indian markets. Ask me anything."}
              </p>
              {!sessionId && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {[
                    "What is SEBI LODR?",
                    "Explain NPA classification",
                    "Calculate VaR example",
                    "Basel III requirements"
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <AnimatePresence>
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                <div
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-2xl relative group",
                      message.role === "user"
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-3"
                        : "bg-slate-800/70 text-slate-100 px-4 py-3"
                    )}
                  >
                    {message.role === "user" && editingId === message.id ? (
                      <div className="space-y-2">
                        <textarea
                          ref={editInputRef}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30 min-h-[60px] resize-none"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitEdit(message.id);
                            }
                            if (e.key === "Escape") {
                              cancelEditing();
                            }
                          }}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={cancelEditing}
                            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => submitEdit(message.id)}
                            className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.role === "user" ? (
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        ) : (
                          <MarkdownRenderer content={message.content} />
                        )}

                        {message.role === "user" && (
                          <button
                            onClick={() => startEditing(message)}
                            className="absolute -right-2 -top-2 p-1.5 rounded-lg bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-600"
                            title="Edit message"
                          >
                            <Edit3 className="w-3 h-3 text-white" />
                          </button>
                        )}

                        {message.role === "assistant" && (
                          <button
                            onClick={() => regenerateResponse(index)}
                            className="absolute -right-2 -top-2 p-1.5 rounded-lg bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-600"
                            title="Regenerate response"
                          >
                            <RefreshCw className="w-3 h-3 text-white" />
                          </button>
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
                      </>
                    )}
                  </div>
                </div>

                {message.riskAnalysis && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-4"
                  >
                    <RiskDisplay
                      overallRisk={message.riskAnalysis.overallRisk}
                      riskScore={message.riskAnalysis.riskScore}
                      factors={message.riskAnalysis.factors}
                      recommendations={message.riskAnalysis.recommendations}
                    />
                  </motion.div>
                )}

                {message.metrics && message.metrics.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-4"
                  >
                    <MetricsGrid metrics={message.metrics} />
                  </motion.div>
                )}

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
                <span className="text-slate-400">
                  {sessionId ? "Analyzing documents..." : "Thinking..."}
                </span>
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
                  : "Ask about SEBI, RBI, trading, or finance..."
              }
              disabled={isLoading}
              className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3.5 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
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

"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  FileSearch,
  Languages,
  LineChart,
  Brain,
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: FileSearch,
    title: "Universal Document Support",
    description:
      "PDF, scanned images, handwritten notes - extract data from any financial document format",
  },
  {
    icon: Languages,
    title: "Multilingual OCR",
    description:
      "Hindi, Tamil, Bengali, Gujarati, English and more. 95%+ accuracy on Indian languages",
  },
  {
    icon: Brain,
    title: "Deep Understanding",
    description:
      "Advanced RAG pipeline that understands context and derives insights beyond the obvious",
  },
  {
    icon: LineChart,
    title: "Visual Analytics",
    description:
      "Beautiful charts generated on-demand from your document data",
  },
  {
    icon: Shield,
    title: "Source Citations",
    description:
      "Every answer comes with exact page references and highlighted sources",
  },
  {
    icon: Zap,
    title: "Blazing Fast",
    description:
      "Sub-second responses powered by Gemini Flash and edge computing",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 px-6 py-4">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">Arthyx</span>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-white text-sm hover:bg-slate-700/50 transition-colors"
          >
            Launch App
          </Link>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="px-6 py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-8">
              <Sparkles className="w-4 h-4" />
              Powered by Gemini AI
            </div>

            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
              Financial Intelligence
              <br />
              <span className="gradient-text">Reimagined</span>
            </h1>

            <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
              Upload any financial document. Ask any question. Get instant,
              accurate insights with source citations and visual analytics.
            </p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                href="/dashboard"
                className="group px-8 py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold flex items-center gap-2 hover:scale-105 transition-transform glow"
              >
                Start Analyzing
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white font-semibold hover:bg-slate-700/50 transition-colors"
              >
                View on GitHub
              </a>
            </motion.div>
          </motion.div>
        </section>

        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Why Arthyx?
              </h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Built for the complexity of Indian financial documents. Rooted
                in Artha (wealth/value).
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="glass rounded-2xl p-6 hover:border-emerald-500/30 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <feature.icon className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-slate-400 text-sm">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto text-center glass rounded-3xl p-12"
          >
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to Transform Your Financial Analysis?
            </h2>
            <p className="text-slate-400 mb-8">
              Join the future of document intelligence. No signup required.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:scale-105 transition-transform glow"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 px-6 py-8 border-t border-slate-800/50">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm text-slate-400">
              Arthyx © {new Date().getFullYear()}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Powered by Google Gemini, Pinecone, and Next.js
          </p>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import {
  FileSearch,
  Languages,
  LineChart,
  Brain,
  ArrowRight,
  Shield,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: FileSearch,
    title: "Universal Document Support",
    description:
      "PDF, Word, Excel, scanned images, handwritten notes - extract data from any format",
  },
  {
    icon: Languages,
    title: "Multilingual Processing",
    description:
      "Hindi, Tamil, Bengali, Gujarati, English and more with high accuracy",
  },
  {
    icon: Brain,
    title: "Deep Understanding",
    description:
      "Context-aware analysis that understands financial data and derives insights",
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
      "Every answer comes with exact references to your documents",
  },
  {
    icon: Zap,
    title: "Real-time Processing",
    description:
      "Watch your documents being analyzed with live progress updates",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.1, 0.15, 0.1] 
          }}
          transition={{ duration: 8, repeat: Infinity }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" 
        />
        <motion.div 
          animate={{ 
            scale: [1.1, 1, 1.1],
            opacity: [0.15, 0.1, 0.15] 
          }}
          transition={{ duration: 8, repeat: Infinity, delay: 2 }}
          className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl" 
        />
      </div>

      <header className="relative z-10 px-6 py-4">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
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
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-8"
            >
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Financial Document Intelligence
            </motion.div>

            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
              Understand Your
              <br />
              <span className="gradient-text">Financial Documents</span>
            </h1>

            <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
              Upload any document. Ask any question. Get instant,
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
                Built for the complexity of financial documents. Rooted
                in Artha (meaning: wealth, value, purpose).
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
                  whileHover={{ y: -5, transition: { duration: 0.2 } }}
                  className="glass rounded-2xl p-6 hover:border-emerald-500/30 transition-all group cursor-default"
                >
                  <motion.div 
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center mb-4"
                  >
                    <feature.icon className="w-6 h-6 text-emerald-400" />
                  </motion.div>
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
              Start analyzing documents in seconds. No signup required.
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
          <div className="flex items-center gap-3">
            <Image 
              src="/logo.png" 
              alt="Arthyx" 
              width={32} 
              height={32}
              className="rounded-lg"
            />
            <span className="text-sm text-slate-400">
              Arthyx © {new Date().getFullYear()}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Financial Document Intelligence Platform
          </p>
        </div>
      </footer>
    </div>
  );
}

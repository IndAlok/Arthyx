"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ArrowRight, FileText, Brain, Zap, Shield, Globe, BarChart3 } from "lucide-react";
import ParticleField from "@/components/ParticleField";
import CursorGlow from "@/components/CursorGlow";

const features = [
  {
    icon: FileText,
    title: "Multi-Format Analysis",
    description: "PDF, Word, Excel, images up to 50MB. Bank annual reports fully supported.",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Globe,
    title: "Indian Language OCR",
    description: "Hindi, Tamil, Bengali, Gujarati, Telugu with 95%+ accuracy on scanned documents.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: Brain,
    title: "Pre-trained Knowledge",
    description: "SEBI, RBI, Basel III, quantitative finance. No documents required for regulatory queries.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: BarChart3,
    title: "Visual Analysis",
    description: "Risk assessment, financial metrics, charts. Automatic visualization of numerical data.",
    gradient: "from-orange-500 to-red-500",
  },
  {
    icon: Shield,
    title: "Knowledge Graph",
    description: "Neo4j-powered entity relationships. Risk contagion simulation across networks.",
    gradient: "from-indigo-500 to-violet-500",
  },
  {
    icon: Zap,
    title: "Blazing Fast",
    description: "Redis caching, session isolation, sub-second responses for repeated queries.",
    gradient: "from-yellow-500 to-orange-500",
  },
];

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  
  const springConfig = { damping: 30, stiffness: 100 };
  const rotateX = useSpring(useMotionValue(0), springConfig);
  const rotateY = useSpring(useMotionValue(0), springConfig);

  useEffect(() => {
    setMounted(true);
    
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;
      
      mouseX.set(clientX);
      mouseY.set(clientY);
      
      const xPercent = (clientX / innerWidth - 0.5) * 2;
      const yPercent = (clientY / innerHeight - 0.5) * 2;
      
      rotateX.set(yPercent * -5);
      rotateY.set(xPercent * 5);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY, rotateX, rotateY]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      <ParticleField />
      <CursorGlow />
      
      <div className="relative z-10">
        <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-xl overflow-hidden">
                <Image src="/logo.png" alt="Arthyx" width={40} height={40} className="w-full h-full object-cover" />
              </div>
              <span className="text-xl font-bold text-white">Arthyx</span>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-emerald-500/50 transition-all duration-300"
              >
                <span>Launch App</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          </div>
        </header>

        <section className="min-h-screen flex items-center justify-center px-6 pt-20">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              style={{ rotateX, rotateY, transformPerspective: 1000 }}
              className="mb-8"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Financial Document Intelligence
              </div>
              
              <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
                Analyze Financial
                <br />
                <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                  Documents with AI
                </span>
              </h1>
              
              <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">
                Advanced RAG with knowledge graphs, multilingual OCR for Indian languages, 
                and pre-trained expertise in SEBI regulations and quantitative finance.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                href="/dashboard"
                className="group relative px-8 py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-emerald-500/30"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Start Analyzing
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-teal-600 to-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </Link>
              
              <a
                href="https://github.com/IndAlok/Arthyx"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-xl border border-slate-700 text-slate-300 font-medium hover:bg-slate-800/50 hover:border-slate-600 transition-all duration-300"
              >
                View on GitHub
              </a>
            </motion.div>
          </div>
        </section>

        <section className="py-24 px-6">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Built for Serious Financial Analysis
              </h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Not another chatbot. A comprehensive platform combining document intelligence, 
                regulatory knowledge, and quantitative analytics.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  whileHover={{ scale: 1.02, y: -5 }}
                  className="group p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50 hover:border-slate-600/50 transition-all duration-300"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-slate-400 text-sm">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 px-6 border-t border-slate-800/50">
          <div className="max-w-4xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
                Ready to Transform Your Analysis?
              </h2>
              <p className="text-slate-400 mb-10 max-w-2xl mx-auto">
                Upload bank annual reports, regulatory filings, or any financial document. 
                Get instant insights in English, Hindi, or any Indian language.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:scale-105 transition-transform shadow-2xl shadow-emerald-500/20"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5" />
              </Link>
            </motion.div>
          </div>
        </section>

        <footer className="py-8 px-6 border-t border-slate-800/50">
          <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-slate-500">
            <span>Arthyx Financial Intelligence</span>
            <span>Built with Next.js, Gemini, Neo4j, Pinecone</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ArrowRight, FileText, Brain, Zap, Shield, Globe, BarChart3, Github, Terminal, GitFork } from "lucide-react";
import ParticleField from "@/components/ParticleField";
import CursorGlow from "@/components/CursorGlow";

const features = [
  {
    icon: Brain,
    title: "Quantitative Intelligence",
    description: "Powered by Gemini 1.5 Pro & Pinecone Vector DB. Performs semantic search over millions of tokens for deep financial context.",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Globe,
    title: "Indian Market & Language",
    description: "Specialized OCR for Hindi, Tamil, Bengali, & Gujarati financial documents. Trained on RBI & SEBI regulatory frameworks.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: BarChart3,
    title: "Automated Risk Risk Modeling",
    description: "Extracts key ratios (NPA, CRAR, ROE) and generates instant credit risk reports using Basel III norms and trend analysis.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Shield,
    title: "Knowledge Audit Graph",
    description: "Neo4j Graph Database integration to visualize hidden relationships between entities, directors, and shell companies.",
    gradient: "from-orange-500 to-red-500",
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
    <div className="min-h-screen bg-[#020617] text-slate-200 overflow-x-hidden selection:bg-emerald-500/30">
      <ParticleField />
      <CursorGlow />
      
      <div className="relative z-10 font-sans">
        {/* Navbar */}
        <header className="fixed top-0 left-0 right-0 z-50 px-6 py-6 backdrop-blur-sm border-b border-white/5 bg-[#020617]/50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 p-[1px]">
                <div className="w-full h-full bg-[#020617] rounded-xl flex items-center justify-center">
                    <span className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">A</span>
                </div>
              </div>
              <span className="text-xl font-bold tracking-tight text-white">Arthyx</span>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-4"
            >
                 <a
                href="https://github.com/IndAlok/Arthyx"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                <Github className="w-4 h-4" />
                <span>Star on GitHub</span>
              </a>

              <Link
                href="/dashboard"
                className="group flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-white hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all duration-300"
              >
                <span>Launch Terminal</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="min-h-screen flex items-center justify-center px-6 pt-32 pb-20">
          <div className="max-w-6xl mx-auto text-center perspective-1000">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              style={{ rotateX, rotateY }}
              className="mb-12"
            >
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium tracking-wide uppercase mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                System Active • v1.0.4 Production
              </div>
              
              <h1 className="text-6xl md:text-8xl font-bold text-white mb-8 tracking-tight leading-[1.1]">
                Algorithmic
                <br />
                <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                  Financial Insight
                </span>
              </h1>
              
              <p className="text-xl md:text-2xl text-slate-400 max-w-3xl mx-auto mb-12 leading-relaxed">
                <span className="text-white font-medium">Arthyx</span> (from Sanskrit <em>Arth</em>: Meaning, Wealth) is an 
                advanced autonomous agent for quantitative document analysis. <br className="hidden md:block"/>
                Seamlessly blending LLM reasoning with strict regulatory contexts.
              </p>

               <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                <Link
                  href="/dashboard"
                  className="group relative px-8 py-4 rounded-xl bg-white text-slate-950 font-bold text-lg overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
                >
                    <span className="relative z-10 flex items-center gap-2">
                        Deploy Agent
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                 </Link>
                 
                 <div className="flex items-center gap-4 text-sm text-slate-500 font-mono">
                    <span className="flex items-center gap-1">
                        <Terminal className="w-4 h-4" />
                        Next.js 15
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                     <span className="flex items-center gap-1">
                        <Brain className="w-4 h-4" />
                        Gemini 2.0
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                    <span className="flex items-center gap-1">
                        <Zap className="w-4 h-4" />
                        Redis
                    </span>
                 </div>
               </div>
            </motion.div>
          </div>
        </section>

        {/* Technical Grid */}
        <section className="py-24 px-6 relative">
          <div className="max-w-7xl mx-auto">
             <div className="flex items-end justify-between mb-16 px-4">
                <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">Engine Architecture</h2>
                    <p className="text-slate-400">High-performance stack designed for data-intensive workloads.</p>
                </div>
                <div className="hidden md:block text-right">
                    <p className="text-xs font-mono text-emerald-500/80">LATENCY &lt; 200ms</p>
                    <p className="text-xs font-mono text-cyan-500/80">ACCURACY &gt; 98.4%</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="group p-8 rounded-3xl bg-slate-900/50 border border-white/5 hover:border-white/10 transition-all duration-500 hover:bg-slate-800/50"
                >
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                    <feature.icon className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{feature.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer/CTA */}
        <section className="py-24 px-6 border-t border-white/5 bg-[#020617]">
          <div className="max-w-4xl mx-auto text-center">
             <h2 className="text-4xl md:text-5xl font-bold text-white mb-8">
                Open Source & <br />
                <span className="text-slate-500">Ready for Wall Street.</span>
            </h2>
             <div className="flex flex-wrap justify-center gap-4 mb-12">
                <a href="https://github.com/IndAlok/Arthyx" target="_blank" className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors">
                    <GitFork className="w-4 h-4" />
                    Fork Repository
                </a>
                 <a href="https://github.com/IndAlok/Arthyx" target="_blank" className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors">
                    <Github className="w-4 h-4" />
                    Star Project
                </a>
            </div>
            
            <p className="text-slate-500 text-sm">
                &copy; {new Date().getFullYear()} Arthyx Intelligence. Designed by <span className="text-emerald-500">Alok</span> for the Future of Finance.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

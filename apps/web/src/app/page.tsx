import { ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F9F9F9] flex flex-col items-center">
      
      {/* Dynamic Background Mesh */}
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-brand-indigo/15 rounded-full blur-[120px] mix-blend-multiply animate-pulse-slow pointer-events-none" />
      <div className="absolute top-40 right-[-100px] w-[600px] h-[600px] bg-brand-violet/15 rounded-full blur-[100px] mix-blend-multiply animate-orbit pointer-events-none" />
      <div className="absolute -left-40 top-1/2 w-[500px] h-[500px] bg-brand-cyan/10 rounded-full blur-[120px] mix-blend-multiply animate-pulse-slow pointer-events-none" />
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-overlay" />

      <div className="w-full max-w-[1400px] p-6 md:p-10 flex flex-col flex-1 z-10 relative">
        
        {/* Top Navigation - Floating Premium */}
        <nav className="flex justify-between items-center bg-white/70 backdrop-blur-xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-2xl p-6 transition-all hover:bg-white/90">
          <div className="font-space font-bold text-2xl tracking-tighter italic bg-brand-gradient text-transparent bg-clip-text">C—O</div>
          <div className="flex gap-8 md:gap-12 text-[10px] uppercase font-black tracking-[0.2em] text-[#1F2235]">
            <Link href="#" className="hover:text-brand-indigo transition-colors relative after:content-[''] after:absolute after:w-full after:scale-x-0 after:h-[2px] after:bottom-[-4px] after:left-0 after:bg-brand-indigo after:origin-bottom-right after:transition-transform hover:after:scale-x-100 hover:after:origin-bottom-left">Collection</Link>
            <Link href="#" className="hover:text-brand-indigo transition-colors relative after:content-[''] after:absolute after:w-full after:scale-x-0 after:h-[2px] after:bottom-[-4px] after:left-0 after:bg-brand-indigo after:origin-bottom-right after:transition-transform hover:after:scale-x-100 hover:after:origin-bottom-left">Method</Link>
            <Link href="/sign-in" className="hover:text-brand-indigo transition-colors relative after:content-[''] after:absolute after:w-full after:scale-x-0 after:h-[2px] after:bottom-[-4px] after:left-0 after:bg-brand-indigo after:origin-bottom-right after:transition-transform hover:after:scale-x-100 hover:after:origin-bottom-left">Log In</Link>
          </div>
        </nav>

        {/* Main Exhibition Area */}
        <section className="mt-24 md:mt-32 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1">
          <div className="lg:col-span-7 flex flex-col justify-center relative animate-float">
            <h1 className="text-[12vw] md:text-[8vw] leading-[0.85] font-space font-extrabold tracking-tighter uppercase mb-8 text-[#0E0F1A]">
              Plain <br /> 
              <span className="relative inline-block">
                <span className="absolute -inset-2 bg-brand-gradient blur-xl opacity-20 rounded-full animate-pulse-slow"></span>
                <span className="relative bg-brand-gradient text-transparent bg-clip-text">Human</span>
              </span> <br /> 
              Content.
            </h1>
            <p className="text-xl md:text-2xl font-light text-[#1F2235] max-w-lg leading-relaxed opacity-80 backdrop-blur-sm bg-white/30 p-4 rounded-xl border border-white/50 shadow-sm">
              We removed the AI-clutter. A surgically pure interface engineered for high-performance narratives.
            </p>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-center h-full">
            <div className="relative group w-full max-w-sm mx-auto aspect-[4/5] rounded-[2rem] overflow-hidden bg-[#0E0F1A] shadow-[0_20px_50px_rgba(43,45,255,0.15)] hover:shadow-[0_20px_50px_rgba(43,45,255,0.3)] transition-all duration-700 hover:-translate-y-2 border border-white/10">
              
              {/* Card Inner Glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-brand-indigo/20 via-transparent to-brand-violet/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              
              <div className="p-10 h-full flex flex-col justify-between relative z-10">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] italic">New Workspace / 2026</span>
                  <Sparkles className="text-brand-cyan w-4 h-4 opacity-50 group-hover:opacity-100 animate-pulse-slow" />
                </div>
                
                <div className="space-y-6">
                  <div className="h-[2px] w-12 bg-gradient-to-r from-brand-cyan to-brand-indigo" />
                  <h3 className="text-4xl md:text-5xl font-space font-bold leading-[1.1] uppercase text-white group-hover:bg-brand-gradient group-hover:text-transparent group-hover:bg-clip-text transition-all duration-500">
                    Start your <br />first draft
                  </h3>
                </div>
                
                <Link href="/dashboard" className="flex items-center justify-between border-t border-white/20 pt-6 text-white/70 group-hover:text-white transition-colors duration-300 relative overflow-hidden">
                  {/* Subtle shining effect over button */}
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:animate-[shimmer_1.5s_infinite]" />
                  <span className="font-bold uppercase text-xs tracking-widest relative z-10">Initialize Engine</span>
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-brand-indigo group-hover:scale-110 transition-all duration-500 relative z-10 shadow-[0_0_15px_rgba(43,45,255,0)] group-hover:shadow-[0_0_20px_rgba(43,45,255,0.5)]">
                    <ArrowUpRight className="w-5 h-5 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] transition-transform duration-300" />
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Grid Features - Structural Premium Design */}
        <section className="mt-32 md:mt-40 mb-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureItem 
              num="01" 
              title="Zero Prompting" 
              desc="The system anticipates intent dynamically based on your brand history. No manual tuning." 
            />
            <FeatureItem 
              num="02" 
              title="Static Output" 
              desc="Surgically clean text. No emojis, no generative fluff, zero hallucinations." 
            />
            <FeatureItem 
              num="03" 
              title="Direct Flow" 
              desc="A frictionless conduit from raw strategic thought to published masterpiece in milliseconds." 
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function FeatureItem({ num, title, desc }: { num: string, title: string, desc: string }) {
  return (
    <div className="p-10 rounded-3xl bg-white/60 backdrop-blur-md border border-white border-b-[#E5E5E5] border-r-[#E5E5E5] shadow-[0_8px_30px_rgb(0,0,0,0.02)] hover:shadow-[0_20px_40px_rgba(122,92,255,0.1)] transition-all duration-500 hover:-translate-y-1 group relative overflow-hidden">
      {/* Hover Gradient Reveal */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-brand-gradient opacity-0 group-hover:opacity-10 blur-[50px] transition-opacity duration-700 pointer-events-none rounded-full" />
      
      <span className="text-xs font-black text-brand-indigo/30 group-hover:text-brand-indigo transition-colors tracking-widest mb-10 block font-space">{num} ——</span>
      <h4 className="text-2xl font-space font-bold uppercase mb-4 text-[#0E0F1A]">{title}</h4>
      <p className="text-sm text-[#7C7F93] leading-relaxed font-medium group-hover:text-[#1F2235] transition-colors">{desc}</p>
    </div>
  );
}

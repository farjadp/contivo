import { ArrowUpRight } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen p-6 md:p-10 flex flex-col">
      {/* Top Navigation - Floating Borders */}
      <nav className="flex justify-between items-center border border-[#121212] p-6 bg-white shadow-[4px_4px_0px_0px_#121212]">
        <div className="font-space font-bold text-2xl tracking-tighter italic">C—O</div>
        <div className="flex gap-10 text-[10px] uppercase font-black tracking-widest">
          <a href="#" className="hover:underline">Collection</a>
          <a href="#" className="hover:underline">Method</a>
          <a href="#" className="hover:underline">Log In</a>
        </div>
      </nav>

      {/* Main Exhibition Area */}
      <section className="mt-20 grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7">
          <h1 className="text-[10vw] leading-[0.8] font-space font-bold tracking-tighter uppercase mb-10">
            Plain <br /> 
            <span className="text-white drop-shadow-[2px_2px_0_#121212] [-webkit-text-stroke:1px_#121212]">Human</span> <br /> 
            Content
          </h1>
          <p className="text-2xl font-light max-w-md leading-tight opacity-70">
            We removed the AI-clutter. A pure interface for high-performance narratives.
          </p>
        </div>

        <div className="lg:col-span-5 flex flex-col justify-end gap-6">
          <div className="aspect-[4/5] bg-white border border-[#121212] relative group overflow-hidden shadow-[12px_12px_0px_0px_rgba(18,18,18,0.05)] hover:shadow-[12px_12px_0px_0px_#121212] transition-all duration-500">
            <div className="p-8 h-full flex flex-col justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-30 italic">New Workspace / 2026</span>
              <div className="space-y-4">
                <div className="h-1 w-12 bg-black" />
                <h3 className="text-4xl font-space font-bold leading-none uppercase">Start your <br />first draft</h3>
              </div>
              <button className="flex items-center justify-between border-t border-black pt-4 group-hover:bg-black group-hover:text-white transition-colors duration-300">
                <span className="font-bold uppercase text-xs">Initialize Engine</span>
                <ArrowUpRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Grid Features - Structural Design */}
      <section className="mt-32 border-t border-[#121212] grid grid-cols-1 md:grid-cols-3">
        <FeatureItem 
          num="01" 
          title="Zero Prompting" 
          desc="The system anticipates intent based on your brand history." 
        />
        <FeatureItem 
          num="02" 
          title="Static Output" 
          desc="Clean, raw text. No emojis, no fluff, no AI-hallucinations." 
        />
        <FeatureItem 
          num="03" 
          title="Direct Flow" 
          desc="From thought to published post in a single uninterrupted stream." 
        />
      </section>
    </main>
  );
}

function FeatureItem({ num, title, desc }: { num: string, title: string, desc: string }) {
  return (
    <div className="p-10 border-r border-[#121212] last:border-r-0 hover:bg-white transition-colors group">
      <span className="text-xs font-black opacity-20 group-hover:opacity-100 transition-opacity underline mb-10 block">{num}</span>
      <h4 className="text-xl font-space font-bold uppercase mb-4">{title}</h4>
      <p className="text-sm opacity-60 leading-relaxed font-medium">{desc}</p>
    </div>
  );
}

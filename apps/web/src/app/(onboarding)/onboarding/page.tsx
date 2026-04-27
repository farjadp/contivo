import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function OnboardingWelcomePage() {
  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row">
      {/* Left Column: Intro */}
      <div className="w-full lg:w-[45%] p-8 pt-32 lg:p-16 xl:p-24 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-[#121212]/10 bg-[#EFECE5]">
        <h1 className="text-6xl md:text-7xl lg:text-[6rem] font-medium tracking-tighter leading-[0.9] text-[#121212] mb-10 overflow-hidden">
          <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">Begin</div>
          <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
              <span className="italic text-[#121212]/50 font-serif font-light">shaping</span>
          </div>
          <div className="animate-in slide-in-from-bottom duration-700 delay-300 fill-mode-both">your system.</div>
        </h1>
        <p className="max-w-md text-xl text-[#121212]/70 leading-relaxed font-medium animate-in fade-in duration-1000 delay-500 fill-mode-both">
          Contivo brings clarity to your content. Choose a path to construct your long-term strategy, or skip the setup to generate instantly.
        </p>
      </div>

      {/* Right Column: Choices */}
      <div className="w-full lg:w-[55%] flex flex-col animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
         {/* Choice 1: Build Workspace */}
         <Link 
            href={"/growth/new" as any}
            className="group flex-1 p-8 lg:p-16 xl:p-20 flex flex-col justify-between border-b border-[#121212]/10 bg-[#FDFCF8] hover:bg-[#D9E2DC] transition-colors duration-500 ease-out cursor-pointer"
         >
            <div className="flex justify-between items-start">
               <span className="text-sm font-bold tracking-widest text-[#121212]/50 group-hover:text-[#121212] transition-colors uppercase">
                  01 &mdash; Recommended
               </span>
               <div className="w-14 h-14 rounded-full border border-[#121212]/20 flex items-center justify-center group-hover:bg-[#121212] group-hover:text-white transition-all duration-500">
                  <ArrowRight className="w-6 h-6 group-hover:-rotate-45 transition-transform duration-500" />
               </div>
            </div>
            <div className="mt-20 lg:mt-0">
               <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tighter mb-4 group-hover:translate-x-6 transition-transform duration-500 will-change-transform">
                 Build Workspace
               </h2>
               <p className="text-lg md:text-xl text-[#121212]/50 max-w-sm group-hover:translate-x-6 transition-transform duration-500 delay-75 group-hover:text-[#121212]/80 will-change-transform">
                  Establish your brand identity and set up a comprehensive, data-driven marketing engine.
               </p>
            </div>
         </Link>

         {/* Choice 2: Instant Content */}
         <Link 
            href={"/instant" as any}
            className="group flex-1 p-8 lg:p-16 xl:p-20 flex flex-col justify-between bg-[#FDFCF8] hover:bg-[#EBE2D5] transition-colors duration-500 ease-out cursor-pointer"
         >
            <div className="flex justify-between items-start">
               <span className="text-sm font-bold tracking-widest text-[#121212]/50 group-hover:text-[#121212] transition-colors uppercase">
                  02 &mdash; Fast Track
               </span>
               <div className="w-14 h-14 rounded-full border border-[#121212]/20 flex items-center justify-center group-hover:bg-[#121212] group-hover:text-white transition-all duration-500">
                  <ArrowRight className="w-6 h-6 group-hover:-rotate-45 transition-transform duration-500" />
               </div>
            </div>
            <div className="mt-20 lg:mt-0">
               <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tighter mb-4 group-hover:translate-x-6 transition-transform duration-500 will-change-transform">
                 Instant Content
               </h2>
               <p className="text-lg md:text-xl text-[#121212]/50 max-w-sm group-hover:translate-x-6 transition-transform duration-500 delay-75 group-hover:text-[#121212]/80 will-change-transform">
                  No configuration needed. Give a topic, choose a platform, and get polished posts in seconds.
               </p>
            </div>
         </Link>
      </div>
    </div>
  );
}

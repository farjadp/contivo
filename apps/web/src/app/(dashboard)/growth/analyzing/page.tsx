'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const STEPS = [
  { id: 1, text: 'Connecting to your website' },
  { id: 2, text: 'Reading your key pages' },
  { id: 3, text: 'Understanding your brand and audience' },
  { id: 4, text: 'Building your Brand Memory' },
];

export default function GrowthAnalyzingPage() {
  return (
    <Suspense fallback={<AnalyzingFallback />}>
      <GrowthAnalyzingContent />
    </Suspense>
  );
}

function GrowthAnalyzingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('id');

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (!workspaceId) {
      router.push('/growth');
      return;
    }

    const intervals = [1500, 2500, 3000, 1500]; // Timings for each step
    let currentInx = 0;

    const runSteps = async () => {
      for (const time of intervals) {
        await new Promise(resolve => setTimeout(resolve, time));
        currentInx++;
        setCurrentStepIndex(currentInx);
      }
      
      // All steps done, wait a tiny bit and redirect to Brand Memory
      setTimeout(() => {
        router.push(`/growth/${workspaceId}?tab=strategy` as any);
      }, 500);
    };

    runSteps();

  }, [router, workspaceId]);

  return (
    <AnalyzingLayout currentStepIndex={currentStepIndex} />
  );
}

function AnalyzingFallback() {
  return <AnalyzingLayout currentStepIndex={0} />;
}

function AnalyzingLayout({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <div className="w-full h-full min-h-[80vh] flex flex-col lg:flex-row bg-[#FDFCF8] text-[#121212] overflow-hidden rounded-[32px] border border-[#121212]/10">
      
      {/* Left Column: Intro */}
      <div className="w-full lg:w-[45%] p-8 lg:p-12 xl:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#121212]/10 bg-[#EFECE5]">
        <div>
           <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase opacity-50 mb-16">
              Processing &mdash; System Active
           </div>

           <h1 className="text-5xl md:text-6xl font-medium tracking-tighter leading-[1] text-[#121212] mb-8">
             <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">Analyzing</div>
             <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
                 <span className="italic text-[#121212]/50 font-serif font-light">website</span>
             </div>
           </h1>
           
           <p className="text-lg text-[#121212]/70 leading-relaxed font-medium max-w-sm animate-in fade-in duration-1000 delay-300 fill-mode-both">
             Contivo intelligence engine is actively reading your pages. This typically requires approximately 10 seconds.
           </p>
        </div>

        <div className="hidden lg:flex items-center gap-3 mt-12 animate-pulse">
            <div className="w-3 h-3 bg-[#C04C36]" />
            <span className="text-xs font-bold tracking-widest uppercase opacity-40">Do not close window</span>
        </div>
      </div>

      {/* Right Column: Steps Progress array */}
      <div className="w-full lg:w-[55%] p-8 lg:p-12 xl:p-24 flex flex-col justify-center bg-[#FDFCF8] animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
         <div className="w-full max-w-md mx-auto relative pl-4">
             {/* Timeline line */}
             <div className="absolute left-0 top-6 bottom-6 w-[2px] bg-[#121212]/10 rounded-full" />
             
             {STEPS.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isPast = index < currentStepIndex;

                return (
                  <div
                    key={step.id}
                    className={`relative py-6 pl-8 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isPast ? 'opacity-40 translate-x-0' : isActive ? 'opacity-100 translate-x-2' : 'opacity-20 translate-x-0'
                    }`}
                  >
                     {/* Timeline Node */}
                     <div className={`absolute left-[-5px] top-[calc(50%-5px)] w-[12px] h-[12px] rounded-sm transition-all duration-700 ${
                         isPast ? 'bg-[#121212]/40' : isActive ? 'bg-[#C04C36]' : 'bg-[#121212]/20'
                     }`} 
                     style={{
                         transform: isActive ? 'rotate(45deg) scale(1.2)' : 'rotate(0deg)'
                     }} />

                     <div className="flex flex-col">
                        <span className={`text-[10px] sm:text-xs font-bold tracking-widest uppercase mb-1 transition-colors duration-500 ${
                            isActive ? 'text-[#C04C36]' : 'text-[#121212]/40'
                        }`}>
                           Phase 0{step.id} 
                           {isActive && <span className="ml-2 lowercase italic font-serif font-medium tracking-normal text-[#121212]/60 animate-pulse">Running...</span>}
                           {isPast && <span className="ml-2 lowercase italic font-serif font-medium tracking-normal text-[#121212]/40">Complete</span>}
                        </span>
                        <span className={`text-xl md:text-2xl font-medium tracking-tighter transition-colors duration-500 ${
                          isPast ? 'text-[#121212] line-through decoration-[#121212]/30' : isActive ? 'text-[#121212]' : 'text-[#121212]/60'
                        }`}>
                          {step.text}
                        </span>
                     </div>
                  </div>
                );
             })}
         </div>
      </div>
    </div>
  );
}

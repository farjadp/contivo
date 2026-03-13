'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, CheckCircle2, Globe, FileSearch, Sparkles, BrainCircuit } from 'lucide-react';

const STEPS = [
  { id: 1, text: 'Connecting to your website', icon: Globe },
  { id: 2, text: 'Reading your key pages', icon: FileSearch },
  { id: 3, text: 'Understanding your brand and audience', icon: BrainCircuit },
  { id: 4, text: 'Building your Brand Memory', icon: Sparkles },
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
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-lg mx-auto py-12 px-6">
      
      <div className="mb-10 relative">
        <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 rounded-full animate-pulse" />
        <div className="w-20 h-20 rounded-2xl bg-[#121212] flex items-center justify-center shadow-xl relative z-10 animate-bounce">
          <Bot className="h-10 w-10 text-white" />
        </div>
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight text-[#121212] mb-3 text-center">
        Analyzing your website
      </h1>
      <p className="text-gray-500 mb-10 text-center text-sm">
        Please wait while Contivo works its magic. This usually takes about 10 seconds.
      </p>

      <div className="w-full space-y-5 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        {STEPS.map((step, index) => {
          const isActive = index === currentStepIndex;
          const isPast = index < currentStepIndex;
          const Icon = step.icon;

          return (
            <div
              key={step.id}
              className={`flex items-center gap-4 transition-all duration-500 ${
                isPast ? 'opacity-50' : isActive ? 'opacity-100 scale-105 transform' : 'opacity-20'
              }`}
            >
              <div className="relative">
                {isPast ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : isActive ? (
                  <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                ) : (
                  <div className="h-6 w-6 rounded-full border-2 border-gray-200" />
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span
                  className={`text-sm font-semibold transition-colors ${
                    isPast ? 'text-gray-500 line-through decoration-gray-300' : isActive ? 'text-[#121212]' : 'text-gray-300'
                  }`}
                >
                  {step.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

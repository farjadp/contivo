import Link from 'next/link';
import { ArrowRight, Zap, TrendingUp } from 'lucide-react';

export default function OnboardingWelcomePage() {
  return (
    <div className="w-full max-w-2xl">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-[#121212] tracking-tight mb-3">
          Welcome to Contivo
        </h1>
        <p className="text-lg text-gray-500">
          Let&apos;s build your first content system. Choose how you want to start.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Primary: Build Workspace */}
        <Link
          href={"/growth/new" as any}
          className="group relative flex flex-col gap-4 rounded-2xl border-2 border-[#121212] bg-[#121212] p-8 text-white hover:bg-white hover:text-[#121212] transition-all duration-300"
        >
          <div className="h-12 w-12 rounded-xl bg-white/10 group-hover:bg-[#121212]/10 flex items-center justify-center transition-colors">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-60 mb-2">Recommended</div>
            <h2 className="text-xl font-bold mb-2">Build My Workspace</h2>
            <p className="text-sm opacity-70 leading-relaxed">
              Set up your brand, get an AI strategy, and generate a full content system. Best for serious content marketing.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold mt-auto">
            Get Started <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Secondary: Quick Content */}
        <Link
          href={"/instant" as any}
          className="group flex flex-col gap-4 rounded-2xl border-2 border-gray-200 bg-white p-8 text-[#121212] hover:border-[#121212] transition-all duration-300"
        >
          <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center">
            <Zap className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Quick Mode</div>
            <h2 className="text-xl font-bold mb-2">Quick Content</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              Give a topic, pick a channel, and get content in seconds. No setup needed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 group-hover:text-[#121212] mt-auto transition-colors">
            Skip &amp; Create <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>
    </div>
  );
}

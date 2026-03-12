import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Zap, TrendingUp, ArrowRight, Plus, Coins } from 'lucide-react';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const userId = session.userId as string;

  // Get user's latest workspace and credit balance in parallel
  const [workspace, credits] = await Promise.all([
    prisma.workspace.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.creditLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
  ]);

  // New users without workspace → onboard them
  if (!workspace) redirect('/onboarding');

  const balance = credits._sum.amount ?? 0;
  const brand = (workspace.brandSummary as Record<string, string>) || {};
  const name = (session.email as string).split('@')[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-sm text-gray-400 mb-1 font-medium">{workspace.name}</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#121212] capitalize">
            Welcome back, {name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {brand.whatYouDo
              ? `${brand.whatYouDo.substring(0, 80)}${brand.whatYouDo.length > 80 ? '…' : ''}`
              : 'Your content workspace is ready.'}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm shrink-0">
          <Coins className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-bold text-[#121212]">{balance}</span>
          <span className="text-sm text-gray-400">credits</span>
        </div>
      </div>

      {/* Brand summary card */}
      {brand.targetAudience && (
        <div className="rounded-2xl border border-gray-200 bg-[#121212] text-white p-6">
          <div className="text-xs font-bold uppercase tracking-widest opacity-50 mb-4">Your Brand Profile</div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold opacity-50 mb-1">Audience</div>
              <p className="text-sm">{brand.targetAudience}</p>
            </div>
            <div>
              <div className="text-xs font-semibold opacity-50 mb-1">Tone</div>
              <p className="text-sm">{brand.tone || '—'}</p>
            </div>
            <div>
              <div className="text-xs font-semibold opacity-50 mb-1">Goal</div>
              <p className="text-sm">{brand.goal || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Create Content</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Instant content */}
          <Link
            href={'/instant' as any}
            className="group flex flex-col gap-4 rounded-2xl border-2 border-gray-200 bg-white p-6 hover:border-[#121212] transition-all"
          >
            <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-[#121212] mb-1">Instant Content</h3>
              <p className="text-xs text-gray-500 leading-relaxed">Generate a LinkedIn post, tweet, email or blog outline in seconds.</p>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-[#121212] mt-auto group-hover:gap-2 transition-all">
              Create now <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          {/* Growth Engine */}
          <Link
            href={'/growth' as any}
            className="group flex flex-col gap-4 rounded-2xl border-2 border-gray-200 bg-white p-6 hover:border-[#121212] transition-all"
          >
            <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-[#121212] mb-1">Growth Engine</h3>
              <p className="text-xs text-gray-500 leading-relaxed">Build a full content strategy with pillars, topics, and a calendar.</p>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-[#121212] mt-auto group-hover:gap-2 transition-all">
              Open Engine <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          {/* New workspace */}
          <Link
            href={'/onboarding' as any}
            className="group flex flex-col gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-6 hover:border-[#121212] transition-all"
          >
            <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-[#121212] mb-1">New Workspace</h3>
              <p className="text-xs text-gray-500 leading-relaxed">Set up another brand or client workspace with its own strategy.</p>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-gray-500 mt-auto group-hover:text-[#121212] group-hover:gap-2 transition-all">
              Add workspace <ArrowRight className="h-3 w-3" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

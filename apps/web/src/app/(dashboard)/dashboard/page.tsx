/**
 * User Dashboard Page - Breathtaking Bento-Box Edition
 *
 * A highly premium, light-themed dashboard using a bento-box layout.
 * Features: Soft shadows, bold typography, glowing gradient accents,
 * and high-contrast primary elements for a stunning visual impact.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Compass,
  Flame,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { getSession } from '@/lib/auth';
import { listWorkspaceActivityLogs } from '@/lib/activity-log';
import { listWorkspaceArchiveStates } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { buildWorkspaceProgressReport } from '@/lib/workspace-progress';

// ─── Types ─────────────────────────────────────────────────────────────────────

type ContentStatusKey =
  | 'DRAFT' | 'GENERATED' | 'EDITED' | 'READY'
  | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function clampPercent(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}



function countStatuses(items: Array<{ status: string }>): Record<ContentStatusKey, number> {
  const s: Record<ContentStatusKey, number> = {
    DRAFT: 0, GENERATED: 0, EDITED: 0, READY: 0,
    SCHEDULED: 0, PUBLISHING: 0, PUBLISHED: 0, FAILED: 0, ARCHIVED: 0,
  };
  for (const i of items) if (i.status in s) s[i.status as ContentStatusKey]++;
  return s;
}


function kiqScore(opts: { ops: number; high: number; serp: number }) {
  return clampPercent(Math.min(40, opts.ops * 2) + Math.min(35, opts.high * 4) + Math.min(25, opts.serp * 3));
}

function buildActions(w: {
  id: string; brandScore: number; accepted: number; ops: number;
  drafts: number; ready: number; scheduled: number; upcoming: number;
}) {
  const a: Array<{ title: string; desc: string; href: string; icon: 'sparkles' | 'target' | 'trending' | 'calendar' | 'zap' }> = [];
  if (w.brandScore < 70) a.push({ title: 'Fortify Brand Assets', desc: 'Clarity is low. Add missing brand info.', href: `/growth/${w.id}?tab=strategy`, icon: 'sparkles' });
  if (w.accepted < 3) a.push({ title: 'Map the Market', desc: 'Select more rivals to analyze.', href: `/growth/${w.id}?tab=matrices`, icon: 'target' });
  if (w.ops > 0) a.push({ title: 'Capture Search Volume', desc: `${w.ops} keywords ready to target.`, href: `/growth/${w.id}?tab=ideation`, icon: 'trending' });
  if (w.drafts + w.ready > 0) a.push({ title: 'Schedule Inbox', desc: `${w.drafts + w.ready} pending drafts. Queue them up.`, href: `/growth/${w.id}/calendar`, icon: 'calendar' });
  if (w.scheduled === 0 && w.upcoming === 0) a.push({ title: 'Maintain Momentum', desc: 'No posts scheduled. Break the silence.', href: `/growth/${w.id}?tab=pipeline`, icon: 'zap' });
  return a.slice(0, 3);
}

// ─── Visual Components ─────────────────────────────────────────────────────────



function NextActionCard({ title, desc, href, icon }: { title: string; desc: string; href: string; icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    sparkles: <Sparkles className="h-5 w-5 text-[#2B2DFF]" />,
    target: <Target className="h-5 w-5 text-indigo-500" />,
    trending: <TrendingUp className="h-5 w-5 text-emerald-500" />,
    calendar: <CalendarDays className="h-5 w-5 text-amber-500" />,
    zap: <Zap className="h-5 w-5 text-rose-500" />,
  };
  const bgs: Record<string, string> = {
    sparkles: 'bg-indigo-50',
    target: 'bg-blue-50',
    trending: 'bg-emerald-50',
    calendar: 'bg-amber-50',
    zap: 'bg-rose-50',
  };

  return (
    <Link href={href as any} className="group relative flex items-center justify-between overflow-hidden rounded-[20px] bg-white border border-gray-100 p-4 transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5">
      <div className="flex items-center gap-4 z-10">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${bgs[icon]} transition-transform duration-300 group-hover:scale-110 shadow-sm`}>
          {icons[icon]}
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{desc}</p>
        </div>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400 transition-colors group-hover:bg-[#2B2DFF] group-hover:text-white z-10">
        <ArrowUpRight className="h-4 w-4" />
      </div>
      {/* Subtle hover glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-gray-50/50 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

function GridStat({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: any; color: string }) {
  return (
    <div className="flex flex-col justify-between rounded-[24px] bg-white border border-gray-100 p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] transition hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-${color}-50 text-${color}-600`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{sub}</span>
      </div>
      <div className="mt-6">
        <p className="text-3xl font-black text-gray-900 tracking-tight">{value}</p>
        <p className="mt-1 text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const userId = session.userId;

  const candidateWorkspaces = await prisma.workspace.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: { id: true, name: true, updatedAt: true },
  });

  const archiveStates = await listWorkspaceArchiveStates(candidateWorkspaces.map((w: any) => w.id));
  const visibleWorkspace = candidateWorkspaces.find((w: any) => !archiveStates.get(w.id)?.isArchived);

  if (!visibleWorkspace) {
    if (candidateWorkspaces.length > 0) {
      return (
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gray-50 shadow-inner">
              <span className="text-4xl">📦</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-900">Workspaces Archived</h1>
            <p className="mt-3 text-sm font-medium text-gray-500 max-w-sm mx-auto">Create a new workspace or ask your administrator to restore an existing one.</p>
            <Link href="/growth/new" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-[#2B2DFF] px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-600/20 hover:scale-105 transition-transform">
              <Plus className="h-5 w-5" /> Start New Workspace
            </Link>
          </div>
        </div>
      );
    }
    redirect('/onboarding');
  }

  const today = new Date();
  const startOfToday = new Date(today); startOfToday.setHours(0, 0, 0, 0);
  const startOfThisWeek = new Date(today); startOfThisWeek.setDate(today.getDate() - 7);

  const [workspace, balance, , logs, highKeywords, , upcoming] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: visibleWorkspace.id },
      include: {
        contentItems: {
          select: { id: true, topic: true, channel: true, status: true, scheduledAtUtc: true, publishedAtUtc: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        competitors: {
          select: { id: true, userDecision: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        },
        _count: { select: { competitors: true, contentItems: true, competitorKeywords: true, keywordOpportunities: true, serpAnalyses: true } },
      },
    }),
    prisma.creditLedger.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.creditLedger.aggregate({ where: { userId, createdAt: { gte: startOfToday }, amount: { lt: 0 } }, _sum: { amount: true } }),
    listWorkspaceActivityLogs(userId, visibleWorkspace.id, 300),
    prisma.keywordOpportunity.count({ where: { workspaceId: visibleWorkspace.id, opportunityScore: { gte: 40 } } }),
    prisma.serpAnalysis.findFirst({ where: { workspaceId: visibleWorkspace.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.contentItem.findMany({
      where: { workspaceId: visibleWorkspace.id, userId, scheduledAtUtc: { not: null, gte: new Date() }, status: { in: ['READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED'] } },
      orderBy: { scheduledAtUtc: 'asc' },
      take: 4,
    }),
  ]);

  if (!workspace) redirect('/growth');

  const counts = countStatuses(workspace.contentItems);
  const accepted = workspace.competitors.filter((c: any) => c.userDecision === 'ACCEPTED');

  const report = buildWorkspaceProgressReport({
    workspace: {
      createdAt: workspace.createdAt,
      brandSummary: workspace.brandSummary,
      audienceInsights: workspace.audienceInsights,
      contentItems: workspace.contentItems.map((i: any) => ({ status: i.status, channel: i.channel })),
      competitors: workspace.competitors.map((i: any) => ({ userDecision: i.userDecision ?? '' })),
    },
    activityLogs: logs,
  });

  const brandScore = clampPercent((report?.dimension_scores.brand_understanding.now || 3) * 10);
  const marketScore = clampPercent((report?.dimension_scores.market_intelligence.now || 2) * 10);
  const seoScore = kiqScore({ ops: workspace._count.keywordOpportunities, high: highKeywords, serp: workspace._count.serpAnalyses });
  const publishScore = clampPercent((report?.dimension_scores.distribution_readiness.now || 1) * 10);
  const overallScore = clampPercent(report ? report.overall_score_now * 10 : (brandScore + marketScore + seoScore + publishScore) / 4);

  const creditsLeft = balance._sum.amount ?? 0;

  const actions = buildActions({
    id: workspace.id, brandScore, accepted: accepted.length,
    ops: workspace._count.keywordOpportunities,
    drafts: counts.DRAFT + counts.GENERATED + counts.EDITED,
    ready: counts.READY, scheduled: counts.SCHEDULED, upcoming: upcoming.length,
  });

  const firstName = session.email?.split('@')[0] || 'there';

  return (
    <div className="space-y-6 pb-16 pt-2">

      {/* ── BENTO HERO ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">

        {/* Hero Welcome */}
        <div className="relative overflow-hidden rounded-[32px] bg-white border border-gray-100 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] flex flex-col justify-between">
          {/* Subtle gradient blob background */}
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-gradient-to-br from-[#2B2DFF]/10 to-[#00E5FF]/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#2B2DFF] mb-2 px-3 py-1 bg-indigo-50 w-fit rounded-full">
                Active Workspace
              </p>
              <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-gray-900 leading-[1.1]">
                Hello, <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#2B2DFF] to-[#7A5CFF] capitalize">{firstName}</span>.
                <br />
                {workspace.name}
              </h1>
              <p className="mt-4 text-sm font-medium text-gray-500 max-w-md leading-relaxed">
                Your AI-powered engine is warm. You have insights ready to turn into published content.
              </p>
            </div>
          </div>

          <div className="relative z-10 mt-10 flex flex-wrap gap-3">
            <Link href={`/growth/${workspace.id}?tab=ideation`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-gray-900/20 hover:scale-105 transition-transform">
              <BoltIcon className="w-5 h-5 text-amber-400" /> Fast Ideation
            </Link>
            <Link href={`/growth/${workspace.id}`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white border-2 border-gray-100 px-6 py-3.5 text-sm font-bold text-gray-900 hover:border-gray-200 transition-colors">
              Enter Workspace <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Overall Score Bento */}
        <div className="rounded-[32px] bg-gradient-to-br from-[#2B2DFF] to-[#1e1b4b] p-8 shadow-2xl shadow-indigo-500/20 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-30">
            <Target className="w-48 h-48 -mr-12 -mt-12" strokeWidth={0.5} />
          </div>

          <div className="relative z-10">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">Marketing Intelligence</p>
            <h2 className="mt-1 text-xl font-bold">Overall Rating</h2>
          </div>

          <div className="relative z-10 mt-6 flex flex-col items-center justify-center">
            <div className="relative w-40 h-40">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
                <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />
                <circle
                  cx="64" cy="64" r="58" fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeDasharray="364.4"
                  strokeDashoffset={364.4 - (overallScore / 100) * 364.4}
                  strokeLinecap="round"
                  className="text-white transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-black tracking-tighter">{overallScore}</span>
              </div>
            </div>
            <div className="mt-6 w-full space-y-3">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-indigo-200">Brand</span>
                <span className="text-white">{brandScore}%</span>
              </div>
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-indigo-200">SEO / Keywords</span>
                <span className="text-white">{seoScore}%</span>
              </div>
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-indigo-200">Publish Flow</span>
                <span className="text-white">{publishScore}%</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── BENTO GRID ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <GridStat label="Available Credits" value={creditsLeft.toLocaleString()} sub="Tokens" color="indigo" icon={Zap} />
        <GridStat label="Content Ready" value={counts.READY.toString()} sub="Pipeline" color="blue" icon={Target} />
        <GridStat label="Published Posts" value={counts.PUBLISHED.toString()} sub="Active" color="emerald" icon={CheckCircle2} />
        <GridStat label="SEO Hits" value={workspace._count.keywordOpportunities.toLocaleString()} sub="Keywords" color="amber" icon={Flame} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Next Actions */}
        <div className="rounded-[32px] bg-white border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.03)] p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#2B2DFF] mb-1">Growth Levers</p>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Focus on this next</h2>
            </div>
            <Compass className="w-8 h-8 text-gray-200" />
          </div>

          <div className="grid gap-4">
            {actions.length === 0 ? (
              <div className="flex items-center gap-4 rounded-[20px] bg-emerald-50 border border-emerald-100 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-emerald-900">Workspace Optimized</h3>
                  <p className="text-sm font-medium text-emerald-700/80 mt-0.5">Nothing urgent. Keep publishing content.</p>
                </div>
              </div>
            ) : (
              actions.map((act: any, idx: number) => (
                <NextActionCard key={idx} {...act} />
              ))
            )}
          </div>
        </div>

        {/* Content Pipeline Mini */}
        <div className="rounded-[32px] bg-white border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.03)] p-8 flex flex-col">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#2B2DFF] mb-1">Queue</p>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-8">Scheduling</h2>

          {upcoming.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-gray-100 bg-gray-50/50 p-6 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-bold text-gray-400">Nothing lined up</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {upcoming.map((item: any) => (
                <div key={item.id} className="group relative overflow-hidden rounded-[20px] bg-gray-50 p-4 hover:bg-[#2B2DFF] transition-colors">
                  <p className="text-sm font-bold text-gray-900 group-hover:text-white truncate">{item.topic}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 group-hover:text-indigo-200">{item.channel}</span>
                    <span className="text-[10px] font-bold text-gray-500 group-hover:text-white">
                      {new Date(item.scheduledAtUtc || item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Link href={`/growth/${workspace.id}?tab=calendar`} className="mt-auto pt-6 flex w-full items-center justify-center gap-2 text-sm font-bold text-[#2B2DFF] hover:text-indigo-500 transition-colors">
            Open Content Calendar <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

    </div>
  );
}

// ─── Local Icon Components (Since Lucide doesn't export Lightning visually the way I want) ──

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className}>
      <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" />
    </svg>
  );
}

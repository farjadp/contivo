/**
 * Overview — the first screen after sign-in.
 *
 * Reads as a control panel: what Autopilot is doing, what is queued, how
 * ready the workspace is, and the one or two moves that matter next. Data
 * loading is unchanged from the previous version; only the render is new.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Bot, CalendarDays, Plus } from 'lucide-react';

import { getSession } from '@/lib/auth';
import { listWorkspaceActivityLogs } from '@/lib/activity-log';
import { listWorkspaceArchiveStates } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { buildWorkspaceProgressReport } from '@/lib/workspace-progress';
import { buildJourney, type WorkspaceFacts } from '@/lib/workspace-journey';

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
          <div className="max-w-sm border border-ink-200 bg-white p-8">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">Overview</p>
            <h1 className="mt-2 font-display text-[24px] font-bold text-ink-900">All workspaces are archived</h1>
            <p className="mt-2 text-[14px] text-ink-600">
              Create a new workspace, or ask an administrator to restore one.
            </p>
            <Link
              href="/growth/new"
              className="mt-6 inline-flex items-center gap-2 bg-ink-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-800"
            >
              <Plus className="h-4 w-4" /> New workspace
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
      take: 5,
    }),
  ]);

  const [autopilot, lastRun, connectionsCount, sitesCount] = await Promise.all([
    prisma.autopilotPolicy.findFirst({
      where: { workspaceId: visibleWorkspace.id },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.autopilotRun.findFirst({ where: { workspaceId: visibleWorkspace.id }, orderBy: { startedAt: 'desc' } }),
    prisma.socialConnection.count({ where: { workspaceId: visibleWorkspace.id, status: 'CONNECTED' } }),
    prisma.siteConnection.count({ where: { workspaceId: visibleWorkspace.id, status: 'ACTIVE' } }),
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
  const publishedThisWeek = workspace.contentItems.filter(
    (i: any) => i.publishedAtUtc && new Date(i.publishedAtUtc) >= startOfThisWeek,
  ).length;
  const queued = counts.SCHEDULED + counts.PUBLISHING;
  const inPipeline = counts.DRAFT + counts.GENERATED + counts.EDITED + counts.READY;
  const autopilotOn = Boolean(autopilot?.enabled);
  const canPublish = connectionsCount > 0 || sitesCount > 0;
  const journey = buildJourney({
    workspaceId: workspace.id,
    hasBrandSummary: Boolean(workspace.brandSummary),
    acceptedCompetitors: accepted.length,
    totalCompetitors: workspace.competitors.length,
    matrixCharts: Array.isArray((workspace.audienceInsights as any)?.competitiveMatrices?.charts)
      ? (workspace.audienceInsights as any).competitiveMatrices.charts.length
      : 0,
    keywordCompetitors: Array.isArray((workspace.audienceInsights as any)?.competitorKeywordsIntel?.competitors)
      ? (workspace.audienceInsights as any).competitorKeywordsIntel.competitors.length
      : 0,
    hasChannel: connectionsCount > 0 || sitesCount > 0,
    channelLabel: connectionsCount > 0 ? 'Social' : sitesCount > 0 ? 'Website' : null,
    autopilotEnabled: Boolean(autopilot?.enabled),
    publishedCount: counts.PUBLISHED,
    scheduledCount: counts.SCHEDULED,
  } satisfies WorkspaceFacts);

  const ideationReady = Boolean(
    workspace.brandSummary &&
      Array.isArray((workspace.audienceInsights as any)?.competitiveMatrices?.charts) &&
      (workspace.audienceInsights as any).competitiveMatrices.charts.length > 0 &&
      Array.isArray((workspace.audienceInsights as any)?.competitorKeywordsIntel?.competitors) &&
      (workspace.audienceInsights as any).competitorKeywordsIntel.competitors.length > 0,
  );

  return (
    <div className="space-y-8 pb-16">
      {/* ── Page head ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">
            Overview · {workspace.name}
          </p>
          <h1 className="mt-1 font-display text-[28px] font-bold tracking-tight text-ink-900 sm:text-[32px]">
            Good to see you, <span className="capitalize">{firstName}</span>.
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/growth/${workspace.id}?tab=ideation`}
            className="inline-flex items-center gap-2 border border-ink-200 bg-white px-4 py-2 text-[13px] font-medium text-ink-900 hover:border-ink-400"
          >
            Ideate now
          </Link>
          <Link
            href={`/growth/${workspace.id}`}
            className="inline-flex items-center gap-2 bg-ink-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-800"
          >
            Open workspace <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* ── The one next step ───────────────────────────────────────── */}
      {journey.next && (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-ink-900 bg-ink-900 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">
              Step {journey.next.order} of {journey.total} · setup {journey.percent}% done
            </p>
            <p className="mt-1 font-display text-[18px] font-semibold">{journey.next.title}</p>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-300">{journey.next.why}</p>
          </div>
          <Link
            href={journey.next.href as never}
            className="inline-flex shrink-0 items-center gap-2 bg-signal px-4 py-2.5 text-[13px] font-semibold text-signal-ink hover:bg-white"
          >
            {journey.next.action} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* ── Autopilot hero + stats ──────────────────────────────────── */}
      <div className="grid gap-px bg-ink-200 lg:grid-cols-[1.3fr_1fr]">
        {/* Autopilot status */}
        <div className="bg-ink-950 p-7 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-ink-300">
              <Bot className="h-4 w-4" /> Autopilot
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest ${
                autopilotOn ? 'bg-signal text-signal-ink' : 'border border-ink-600 text-ink-300'
              }`}
            >
              {autopilotOn && <span className="h-1.5 w-1.5 animate-pulse bg-signal-ink" />}
              {autopilotOn ? 'On' : 'Off'}
            </span>
          </div>

          <h2 className="mt-5 font-display text-[24px] font-semibold leading-tight">
            {autopilotOn
              ? `${autopilot!.postsPerWeek} posts a week, on ${autopilot!.channels.join(' + ') || 'no channel'}.`
              : 'Not running yet.'}
          </h2>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-300">
            {autopilotOn
              ? lastRun
                ? `Last run ${relative(lastRun.startedAt)}: ${lastRun.status.toLowerCase()} — ${lastRun.itemsScheduled} scheduled, ${lastRun.itemsSkipped} skipped.`
                : 'Enabled — the first run happens on the next tick.'
              : !ideationReady
                ? 'Build the intelligence layer first (brand memory, matrices, keywords) — Autopilot refuses to write without it.'
                : !canPublish
                  ? 'Connect a social account or a website so it has somewhere to publish.'
                  : 'Everything is ready. Turn it on and it keeps your week filled.'}
          </p>

          <div className="mt-6 grid grid-cols-3 gap-px bg-ink-700/60">
            <Metric dark label="Queued" value={queued} />
            <Metric dark label="Published · 7d" value={publishedThisWeek} />
            <Metric dark label="In pipeline" value={inPipeline} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={`/growth/${workspace.id}?tab=autopilot`}
              className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-[13px] font-semibold text-signal-ink hover:bg-white"
            >
              {autopilotOn ? 'Open Autopilot' : 'Set up Autopilot'} <ArrowRight className="h-4 w-4" />
            </Link>
            {!canPublish && (
              <Link
                href="/connections"
                className="inline-flex items-center gap-2 border border-ink-600 px-4 py-2 text-[13px] text-ink-100 hover:border-ink-400"
              >
                Connect a channel
              </Link>
            )}
          </div>
        </div>

        {/* Readiness */}
        <div className="bg-white p-7">
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">Readiness</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-[44px] font-bold leading-none text-ink-900">{overallScore}</span>
            <span className="text-[13px] text-ink-400">/ 100 overall</span>
          </div>
          <dl className="mt-6 space-y-3">
            {[
              ['Brand memory', brandScore],
              ['Market intelligence', marketScore],
              ['Keywords & SEO', seoScore],
              ['Publishing', publishScore],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="flex justify-between text-[12.5px]">
                  <dt className="text-ink-600">{k}</dt>
                  <dd className="font-mono text-ink-900">{v}%</dd>
                </div>
                <div className="mt-1 h-1 bg-ink-100">
                  <div className="h-1 bg-ink-900" style={{ width: `${v}%` }} />
                </div>
              </div>
            ))}
          </dl>
          <div className="mt-6 grid grid-cols-3 gap-px bg-ink-100 text-ink-900">
            <Metric label="Competitors" value={accepted.length} />
            <Metric label="Keywords" value={workspace._count.keywordOpportunities} />
            <Metric label="Credits" value={creditsLeft} />
          </div>
        </div>
      </div>

      {/* ── Next moves + Queue ──────────────────────────────────────── */}
      <div className="grid gap-px bg-ink-200 lg:grid-cols-[1fr_1fr]">
        <div className="bg-white p-7">
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">Next moves</p>
          <h2 className="mt-1 font-display text-[18px] font-semibold text-ink-900">
            {actions.length === 0 ? 'Nothing urgent' : 'What moves the needle'}
          </h2>
          <ul className="mt-5 divide-y divide-ink-100">
            {actions.length === 0 ? (
              <li className="py-3 text-[14px] text-ink-600">
                Intelligence and pipeline are healthy. Let Autopilot run, or ideate by hand.
              </li>
            ) : (
              actions.map((act: any) => (
                <li key={act.title}>
                  <Link href={act.href} className="group flex items-center justify-between gap-4 py-3.5">
                    <div>
                      <p className="text-[14px] font-medium text-ink-900">{act.title}</p>
                      <p className="mt-0.5 text-[13px] text-ink-600">{act.desc}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-900" />
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="bg-white p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">Queue</p>
              <h2 className="mt-1 font-display text-[18px] font-semibold text-ink-900">Coming up</h2>
            </div>
            <Link
              href={`/growth/${workspace.id}?tab=calendar`}
              className="text-[13px] font-medium text-ink-600 hover:text-ink-900"
            >
              Calendar →
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-5 flex items-center gap-3 border border-dashed border-ink-200 p-5 text-[13px] text-ink-600">
              <CalendarDays className="h-5 w-5 text-ink-300" />
              Nothing scheduled. {autopilotOn ? 'Autopilot will fill this on its next run.' : 'Turn on Autopilot or schedule from the pipeline.'}
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-ink-100">
              {upcoming.map((item: any) => (
                <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-ink-900">{item.topic}</p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-widest text-ink-400">{item.channel}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] text-ink-600">
                    {new Date(item.scheduledAtUtc || item.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────────────

function Metric({ label, value, dark }: { label: string; value: number | string; dark?: boolean }) {
  return (
    <div className={dark ? 'bg-ink-950 px-4 py-3' : 'bg-white px-4 py-3'}>
      <p className={`font-mono text-[10.5px] uppercase tracking-widest ${dark ? 'text-ink-400' : 'text-ink-400'}`}>{label}</p>
      <p className={`mt-1 font-display text-[22px] font-semibold ${dark ? 'text-white' : 'text-ink-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function relative(date: Date) {
  const diff = Date.now() - date.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

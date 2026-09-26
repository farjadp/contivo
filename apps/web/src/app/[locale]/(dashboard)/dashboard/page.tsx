/**
 * Today — the first screen after sign-in.
 *
 * Three questions, in reading order: what moved, what to do about it, and
 * what is going out. Everything here is derived from rows that exist — the
 * setup journey, the pipeline, competitor decisions, the last Autopilot run —
 * so an empty workspace gets an honest empty screen, never invented activity.
 */

import { Link, redirect } from '@/i18n/navigation';
import { ArrowRight, Plus } from 'lucide-react';

import { getSession } from '@/lib/auth';
import { listWorkspaceActivityLogs } from '@/lib/activity-log';
import { listWorkspaceArchiveStates } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { buildWorkspaceProgressReport } from '@/lib/workspace-progress';
import { buildJourney, tabGate, type StepId, type WorkspaceFacts } from '@/lib/workspace-journey';
import { buildLoop, STAGES, type StageId } from '@/lib/workspace-loop';
import { LoopRail } from '../growth/[id]/_components/LoopRail';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

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

/*
  The actions carry message keys and the numbers that go into them, never
  rendered English. A function that returns finished sentences cannot be
  translated without translating the function.
*/
type ActionKey = 'brand' | 'market' | 'keywords' | 'schedule' | 'momentum';

type NextAction = {
  key: ActionKey;
  count?: number;
  tab: string;
};

const ACTION_STAGE: Record<ActionKey, StageId> = {
  brand: 'know',
  market: 'watch',
  keywords: 'think',
  schedule: 'ship',
  momentum: 'make',
};

const STEP_STAGE: Record<StepId, StageId> = {
  brand: 'know',
  market: 'watch',
  keywords: 'watch',
  narrative: 'think',
  channel: 'ship',
  autopilot: 'ship',
};

/** A heuristic action that says the same thing as the setup step is dropped. */
const STEP_OVERLAP: Partial<Record<StepId, ActionKey>> = { brand: 'brand', market: 'market' };

function buildActions(w: {
  brandScore: number; accepted: number; ops: number;
  drafts: number; ready: number; scheduled: number; upcoming: number;
}): NextAction[] {
  const a: NextAction[] = [];
  if (w.brandScore < 70) a.push({ key: 'brand', tab: 'strategy' });
  if (w.accepted < 3) a.push({ key: 'market', tab: 'matrices' });
  if (w.ops > 0) a.push({ key: 'keywords', count: w.ops, tab: 'ideation' });
  if (w.drafts + w.ready > 0) a.push({ key: 'schedule', count: w.drafts + w.ready, tab: 'calendar' });
  if (w.scheduled === 0 && w.upcoming === 0) a.push({ key: 'momentum', tab: 'pipeline' });
  return a;
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  // The setup chain's own copy, shared with the workspace page's JourneyGuide.
  const tj = await getTranslations('journey');
  const tw = await getTranslations('growth.workspace');
  const format = await getFormatter();
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

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
          <div className="max-w-sm rounded-2xl border border-rule bg-chalk-raised p-8">
            <h1 className="font-display text-[24px] font-bold">{t('archived.title')}</h1>
            <p className="mt-2 text-[15px] text-moss-muted">{t('archived.body')}</p>
            <Link
              href="/growth/new"
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-moss px-4 text-[14px] font-semibold text-chalk hover:bg-moss-700"
            >
              <Plus className="h-4 w-4" /> {t('archived.cta')}
            </Link>
          </div>
        </div>
      );
    }
    redirect({ href: '/onboarding', locale: await getLocale() });
  }

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  const [workspace, balance, logs, upcoming] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: visibleWorkspace.id },
      include: {
        contentItems: {
          select: { id: true, status: true, scheduledAtUtc: true, publishedAtUtc: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        competitors: {
          select: { id: true, userDecision: true, source: true },
        },
        _count: { select: { keywordOpportunities: true } },
      },
    }),
    prisma.creditLedger.aggregate({ where: { userId }, _sum: { amount: true } }),
    listWorkspaceActivityLogs(userId, visibleWorkspace.id, 300),
    prisma.contentItem.count({
      where: {
        workspaceId: visibleWorkspace.id,
        userId,
        scheduledAtUtc: { not: null, gte: now },
        status: { in: ['READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED'] },
      },
    }),
  ]);

  const [autopilot, lastRun, connectionsCount, sitesCount, storylineCount] = await Promise.all([
    prisma.autopilotPolicy.findFirst({
      where: { workspaceId: visibleWorkspace.id },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.autopilotRun.findFirst({ where: { workspaceId: visibleWorkspace.id }, orderBy: { startedAt: 'desc' } }),
    prisma.socialConnection.count({ where: { workspaceId: visibleWorkspace.id, status: 'CONNECTED' } }),
    prisma.siteConnection.count({ where: { workspaceId: visibleWorkspace.id, status: 'ACTIVE' } }),
    prisma.storyline.count({ where: { narrative: { workspaceId: visibleWorkspace.id }, enabled: true } }),
  ]);

  if (!workspace) redirect({ href: '/growth', locale: await getLocale() });

  const counts = countStatuses(workspace.contentItems);
  const accepted = workspace.competitors.filter((c: any) => c.userDecision === 'ACCEPTED').length;
  // Same rule as the competitor map: undecided is stored as 'PENDING', and an
  // AI-found competitor with no decision yet is pending too.
  const pendingCompetitors = workspace.competitors.filter(
    (c: any) => c.userDecision === 'PENDING' || (!c.userDecision && c.source === 'AI'),
  ).length;

  const report = buildWorkspaceProgressReport({
    workspace: {
      createdAt: workspace.createdAt,
      brandSummary: workspace.brandSummary,
      audienceInsights: workspace.audienceInsights,
      contentItems: workspace.contentItems.map((i: any) => ({ status: i.status, channel: '' })),
      competitors: workspace.competitors.map((i: any) => ({ userDecision: i.userDecision ?? '' })),
    },
    activityLogs: logs,
  });
  const brandScore = clampPercent((report?.dimension_scores.brand_understanding.now || 3) * 10);

  const insights = workspace.audienceInsights as any;
  const facts: WorkspaceFacts = {
    workspaceId: workspace.id,
    hasBrandSummary: Boolean(workspace.brandSummary),
    acceptedCompetitors: accepted,
    totalCompetitors: workspace.competitors.length,
    matrixCharts: Array.isArray(insights?.competitiveMatrices?.charts) ? insights.competitiveMatrices.charts.length : 0,
    keywordCompetitors: Array.isArray(insights?.competitorKeywordsIntel?.competitors)
      ? insights.competitorKeywordsIntel.competitors.length
      : 0,
    storylines: storylineCount,
    hasChannel: connectionsCount > 0 || sitesCount > 0,
    channelLabel: connectionsCount > 0 ? 'Social' : sitesCount > 0 ? 'Website' : null,
    autopilotEnabled: Boolean(autopilot?.enabled),
    publishedCount: counts.PUBLISHED,
    scheduledCount: counts.SCHEDULED,
  };
  const journey = buildJourney(facts);
  const gates = tabGate(facts);
  const loop = buildLoop(
    journey,
    gates,
    STAGES.flatMap((s) => s.tabs).filter((tab) => tab !== 'progress'),
    workspace.contentItems.length > 0,
  );

  // ── Moves: the setup step first, then the heuristics, three at most. ──
  const heuristics = buildActions({
    brandScore,
    accepted,
    ops: workspace._count.keywordOpportunities,
    drafts: counts.DRAFT + counts.GENERATED + counts.EDITED,
    ready: counts.READY,
    scheduled: counts.SCHEDULED,
    upcoming,
  }).filter((a) => !journey.next || STEP_OVERLAP[journey.next.id] !== a.key);

  type Move = { id: string; stage: StageId; title: string; desc: string; cta: string; href: string; tag?: string };
  const moves: Move[] = [
    ...(journey.next
      ? [{
          id: `step-${journey.next.id}`,
          stage: STEP_STAGE[journey.next.id],
          title: tj(journey.next.title.key, journey.next.title.values),
          desc: tj(journey.next.why.key, journey.next.why.values),
          cta: tj(journey.next.action.key, journey.next.action.values),
          href: journey.next.href,
          tag: t('today.setupTag', { order: journey.next.order, total: journey.total }),
        }]
      : []),
    ...heuristics.map((a) => ({
      id: a.key,
      stage: ACTION_STAGE[a.key],
      title: t(`actions.${a.key}Title`),
      desc: t(`actions.${a.key}Desc`, { count: a.count ?? 0 }),
      cta: t(`actions.${a.key}Cta`),
      href: `/growth/${workspace.id}?tab=${a.tab}`,
    })),
  ].slice(0, 3);

  // ── What moved: only things with a row behind them. ──
  const publishedThisWeek = workspace.contentItems.filter(
    (i: any) => i.publishedAtUtc && new Date(i.publishedAtUtc) >= weekAgo,
  ).length;
  const moved: Array<{ tag: string; text: string; href?: string; cta?: string }> = [];
  if (lastRun && new Date(lastRun.startedAt) >= weekAgo) {
    moved.push({
      tag: t('today.moved.tagAutopilot'),
      text: t('today.moved.autopilot', {
        when: format.relativeTime(lastRun.startedAt),
        scheduled: lastRun.itemsScheduled,
        skipped: lastRun.itemsSkipped,
      }),
    });
  }
  if (publishedThisWeek > 0) {
    moved.push({ tag: t('today.moved.tagPublished'), text: t('today.moved.published', { count: publishedThisWeek }) });
  }
  if (pendingCompetitors > 0) {
    moved.push({
      tag: t('today.moved.tagCompetitors'),
      text: t('today.moved.pending', { count: pendingCompetitors }),
      href: `/growth/${workspace.id}?tab=matrices`,
      cta: t('today.moved.pendingCta'),
    });
  }

  // ── Shipping week: three days back, today, three ahead. Bucketed with the
  //    formatter so days split in the reader's time zone, not the server's. ──
  const dayKey = (d: Date) => format.dateTime(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i - 3);
    return { date: d, key: dayKey(d), isToday: i === 3, published: 0, scheduled: 0 };
  });
  const byKey = new Map(week.map((d) => [d.key, d]));
  for (const item of workspace.contentItems as any[]) {
    if (item.publishedAtUtc) {
      const day = byKey.get(dayKey(new Date(item.publishedAtUtc)));
      if (day) day.published++;
    } else if (item.scheduledAtUtc && ['READY', 'SCHEDULED', 'PUBLISHING'].includes(item.status)) {
      const day = byKey.get(dayKey(new Date(item.scheduledAtUtc)));
      if (day) day.scheduled++;
    }
  }

  const pipe = [
    { key: 'drafting', value: counts.DRAFT + counts.GENERATED + counts.EDITED },
    { key: 'ready', value: counts.READY },
    { key: 'scheduled', value: counts.SCHEDULED + counts.PUBLISHING },
    { key: 'published', value: counts.PUBLISHED },
  ] as const;
  const pipeMax = Math.max(1, ...pipe.map((p) => p.value));

  const autopilotOn = Boolean(autopilot?.enabled);
  const canPublish = connectionsCount > 0 || sitesCount > 0;
  const ideationReady = Boolean(workspace.brandSummary) && facts.matrixCharts > 0 && facts.keywordCompetitors > 0;
  const creditsLeft = balance._sum.amount ?? 0;
  const activeStage = moves[0]?.stage ?? 'make';

  return (
    <div className="space-y-8">
      {/* ── The loop, for this workspace ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={{ pathname: '/growth/[id]', params: { id: workspace.id } }}
            className="inline-flex items-center gap-2 text-[15px] font-semibold hover:text-moss-700"
          >
            {workspace.name}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
          <span className="font-plexmono text-[12px] text-moss-muted">
            {t('today.credits', { count: creditsLeft })}
          </span>
        </div>
        <LoopRail
          workspaceId={workspace.id}
          stages={loop}
          activeStage={activeStage}
          activeTab=""
          tabs={[]}
          names={Object.fromEntries(STAGES.map((s) => [s.id, tw(`loop.${s.id}.name`)])) as Record<StageId, string>}
          numbers={
            Object.fromEntries(loop.map((s) => [s.id, format.number(s.order, { minimumIntegerDigits: 2 })])) as Record<
              StageId,
              string
            >
          }
          subs={Object.fromEntries(STAGES.map((s) => [s.id, tw(`loop.${s.id}.sub`)])) as Record<StageId, string>}
          stateLabels={{
            done: tw('loop.state.done'),
            next: tw('loop.state.next'),
            open: tw('loop.state.open'),
            locked: tw('loop.state.locked'),
          }}
          navLabel={tw('loop.tabsLabel')}
          stagesLabel={t('today.loopLabel')}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* ── What moved ─────────────────────────────────────────────── */}
        <section
          aria-labelledby="moved-title"
          className="order-2 flex flex-col gap-5 self-start rounded-2xl bg-forest p-6 text-chalk lg:order-1"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="moved-title" className="font-display text-[22px] font-bold">
              {t('today.moved.title')}
            </h2>
            <span className="font-plexmono text-[12px] text-forest-muted">{t('today.moved.since')}</span>
          </div>
          {moved.length === 0 ? (
            <p className="text-[15px] leading-relaxed text-forest-muted">{t('today.moved.empty')}</p>
          ) : (
            <ul className="divide-y divide-forest-line">
              {moved.map((m) => (
                <li key={m.tag} className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
                  <span className="font-plexmono text-[11px] uppercase tracking-widest text-saffron">{m.tag}</span>
                  <p className="text-[15px] leading-relaxed">{m.text}</p>
                  {m.href && (
                    <Link href={m.href as never} className="text-[14px] underline underline-offset-4 hover:text-saffron">
                      {m.cta}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Next moves ─────────────────────────────────────────────── */}
        <section aria-labelledby="moves-title" className="order-1 min-w-0 lg:order-2">
          <p className="font-plexmono text-[13px] text-moss-muted">
            {format.dateTime(now, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1
            id="moves-title"
            className="mt-1.5 font-display text-[34px] font-bold leading-[1.08] tracking-tight sm:text-[44px]"
          >
            {t('today.headline', { count: moves.length })}
          </h1>

          {moves.length === 0 ? (
            <p className="mt-6 border-t border-moss pt-5 text-[15px] text-moss-muted">{t('today.healthy')}</p>
          ) : (
            <ol className="mt-6">
              {moves.map((move, i) => (
                <li
                  key={move.id}
                  className={`grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-t py-5 sm:grid-cols-[52px_minmax(0,1fr)] ${
                    i === 0 ? 'border-moss' : 'border-rule'
                  } ${i === moves.length - 1 ? 'border-b border-b-rule' : ''}`}
                >
                  <span aria-hidden className="font-plexmono text-[28px] leading-none text-rule-strong">
                    {format.number(i + 1)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-2.5">
                    <h3 className="text-[19px] font-semibold leading-snug">{move.title}</h3>
                    <p className="text-[15px] leading-relaxed text-moss-muted">{move.desc}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-chalk-sunk px-2 py-1 font-plexmono text-[12px]">
                        {tw(`loop.${move.stage}.name`)} · {tw(`loop.${move.stage}.sub`)}
                      </span>
                      {move.tag && (
                        <span className="rounded bg-chalk-sunk px-2 py-1 font-plexmono text-[12px]">{move.tag}</span>
                      )}
                      <Link
                        href={move.href as never}
                        className={`ms-auto inline-flex h-11 items-center gap-2 rounded-lg px-5 text-[14px] font-semibold transition-colors ${
                          i === 0 ? 'bg-saffron text-moss hover:bg-saffron-soft' : 'bg-moss text-chalk hover:bg-moss-700'
                        }`}
                      >
                        {move.cta}
                        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── Shipping ───────────────────────────────────────────────── */}
        <aside className="order-3 flex flex-col gap-8">
          <section aria-labelledby="ship-title" className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between">
              <h2 id="ship-title" className="font-display text-[22px] font-bold">
                {t('today.shipping.title')}
              </h2>
              <Link
                href={{ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'calendar' } }}
                className="text-[14px] font-medium underline underline-offset-4 hover:text-moss-700"
              >
                {t('today.shipping.calendar')}
              </Link>
            </div>
            <ol className="grid grid-cols-7 gap-1.5">
              {week.map((day) => (
                <li key={day.key} className="flex flex-col items-center gap-1">
                  <span
                    className={`font-plexmono text-[11px] ${day.isToday ? 'font-semibold text-moss' : 'text-moss-muted'}`}
                  >
                    {format.dateTime(day.date, { weekday: 'narrow' })}
                  </span>
                  <div
                    className={`flex h-[72px] w-full flex-col justify-end gap-[3px] rounded-md p-1 ${
                      day.isToday ? 'border-2 border-moss bg-chalk-raised' : 'bg-chalk-sunk'
                    }`}
                  >
                    {Array.from({ length: Math.min(day.published, 4) }, (_, k) => (
                      <span key={`p${k}`} className="h-2.5 rounded-sm bg-moss-700" />
                    ))}
                    {Array.from({ length: Math.min(day.scheduled, 4) }, (_, k) => (
                      <span key={`s${k}`} className="h-2.5 rounded-sm bg-saffron" />
                    ))}
                  </div>
                  <span className="sr-only">
                    {format.dateTime(day.date, { weekday: 'long', day: 'numeric' })}
                    {day.isToday ? `, ${t('today.shipping.today')}` : ''}: {t('today.shipping.published')}{' '}
                    {format.number(day.published)}, {t('today.shipping.scheduled')} {format.number(day.scheduled)}
                  </span>
                </li>
              ))}
            </ol>
            <div aria-hidden className="flex gap-4 text-[13px] text-moss-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-moss-700" />
                {t('today.shipping.published')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-saffron" />
                {t('today.shipping.scheduled')}
              </span>
            </div>
          </section>

          <section aria-labelledby="pipe-title" className="flex flex-col gap-3.5">
            <h2 id="pipe-title" className="font-display text-[22px] font-bold">
              {t('today.pipe.title')}
            </h2>
            <dl className="grid grid-cols-[92px_minmax(0,1fr)_32px] items-center gap-x-3 gap-y-2.5 text-[14px]">
              {pipe.map((p) => (
                <div key={p.key} className="contents">
                  <dt>{t(`today.pipe.${p.key}`)}</dt>
                  <div aria-hidden className="h-2 rounded-full bg-chalk-sunk">
                    <div
                      className={`h-2 rounded-full ${p.key === 'scheduled' ? 'bg-saffron' : 'bg-moss'}`}
                      style={{ width: `${(p.value / pipeMax) * 100}%` }}
                    />
                  </div>
                  <dd className="text-end font-plexmono text-[13px]">{format.number(p.value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl border border-dashed border-rule-strong p-5">
            <span className="font-plexmono text-[11px] uppercase tracking-widest text-moss-muted">
              {t('autopilot.label')} · {autopilotOn ? t('autopilot.on') : t('autopilot.off')}
            </span>
            <p className="text-[15px] leading-relaxed">
              {autopilotOn
                ? t('autopilot.running', {
                    posts: autopilot!.postsPerWeek,
                    channels: autopilot!.channels.join(' + ') || t('autopilot.noChannel'),
                  })
                : !ideationReady
                  ? t('autopilot.needsIntelligence')
                  : !canPublish
                    ? t('autopilot.needsChannel')
                    : t('autopilot.ready')}
            </p>
            <Link
              href={
                !autopilotOn && ideationReady && !canPublish
                  ? '/connections'
                  : { pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'autopilot' } }
              }
              className="text-[14px] font-semibold underline underline-offset-4 hover:text-moss-700"
            >
              {autopilotOn
                ? t('autopilot.open')
                : ideationReady && !canPublish
                  ? t('autopilot.connectChannel')
                  : t('autopilot.setUp')}
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

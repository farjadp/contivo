import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/auth';
import { getWorkspaceArchiveState } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { redirect, Link } from '@/i18n/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Coins,
  ExternalLink,
  FileText,
  Lightbulb,
  ListTodo,
  LineChart,
  Package,
  Sparkles,
  Tags,
  CalendarDays,
  TrendingUp,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { BrandMemoryTab } from './_components/BrandMemoryTab';
import { IdeationTab } from './_components/IdeationTab';
import { PipelineTab } from './_components/PipelineTab';
import { CalendarTab } from './_components/CalendarTab';
import {
  getMaxDiscoveryRuns,
  getWorkspaceDiscoveryStats,
  listWorkspaceActivityLogs,
  listWorkspaceDiscoveryArchive,
  writeActivityLog,
} from '@/lib/activity-log';
import {
  getBrandMemoryRescrapeLimit,
  getContentWordCountLimits,
  getDefaultScheduleDelayHours,
  getIdeationMaxContentCount,
} from '@/lib/app-settings';
import { CompetitiveMatricesTab } from './_components/CompetitiveMatricesTab';
import { CompetitorKeywordsTab } from './_components/CompetitorKeywordsTab';
import { ProductsServicesTab } from './_components/ProductsServicesTab';
import { buildWorkspaceProgressReport } from '@/lib/workspace-progress';
import { ProgressReportTab } from './_components/ProgressReportTab';
import { SeoIntelligenceTab } from './_components/SeoIntelligenceTab';
import { ReportsTab } from '@/components/workspace/ReportsTab';
import { AutopilotTab } from './_components/AutopilotTab';
import { NarrativeTab } from './_components/NarrativeTab';
import { JourneyGuide } from './_components/JourneyGuide';
import { LoopRail } from './_components/LoopRail';
import { buildJourney, tabGate, type WorkspaceFacts } from '@/lib/workspace-journey';
import { buildLoop, stageForTab, STAGES, type StageId } from '@/lib/workspace-loop';
import { activeSetupWarnings, isSetupWarningCode } from '@/lib/workspace-setup-warnings';
import { getAutopilotState } from '@/app/actions/autopilot';
import { getNarrative } from '@/app/actions/narrative';
import { getFormatter, getLocale } from 'next-intl/server';
import { missingReportRequirements } from '@/lib/report-readiness';

export async function generateMetadata() {
  const t = await getTranslations('growth.workspace');
  return { title: t('metaTitle') };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type TokenUsageLike = {
  runs?: number;
  lifetime_prompt_tokens?: number;
  lifetime_completion_tokens?: number;
  lifetime_total_tokens?: number;
  last_run?: {
    model?: string;
  } | null;
} | null;

type ModelRate = {
  inputPer1M: number;
  outputPer1M: number;
};

const MODEL_RATES: Record<string, ModelRate> = {
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
};

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function estimateUsageCostUsd(tokenUsage: TokenUsageLike): number {
  if (!tokenUsage) return 0;
  const promptTokens = normalizeNumber(tokenUsage.lifetime_prompt_tokens);
  const completionTokens = normalizeNumber(tokenUsage.lifetime_completion_tokens);
  const model = String(tokenUsage.last_run?.model || process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1');
  const rates = MODEL_RATES[model] || MODEL_RATES['gpt-4.1'];
  const promptCost = (promptTokens / 1_000_000) * rates.inputPer1M;
  const completionCost = (completionTokens / 1_000_000) * rates.outputPer1M;
  return promptCost + completionCost;
}

function resolveTab(rawTab: string | string[] | undefined): string {
  const value = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const allowed = new Set([
    'pipeline',
    'ideation',
    'strategy',
    'progress',
    'matrices',
    'keywords',
    'offerings',
    'narrative',
    'calendar',
    'seo',
    'reports',
    'autopilot',
  ]);
  if (!value || !allowed.has(value)) return 'pipeline';
  return value;
}


export default async function WorkspacePage({ params, searchParams }: Props) {
  const t = await getTranslations('growth.workspace');
  const format = await getFormatter();
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const workspace = await prisma.workspace.findUnique({
    where: {
      id: resolvedParams.id,
      userId: session.userId as string,
    },
    include: {
      contentItems: {
        orderBy: { createdAt: 'desc' }
      },
      competitors: {
        orderBy: { createdAt: 'asc' },
      },
    }
  });

  if (!workspace) notFound();
  const archiveState = await getWorkspaceArchiveState(workspace.id);
  if (archiveState.isArchived) {
    redirect({ href: '/growth', locale: await getLocale() });
  }

  const [
    discoveryStats,
    discoveryArchive,
    maxDiscoveryRuns,
    maxRescrapeRuns,
    maxIdeationItems,
    wordCountLimits,
    defaultScheduleDelayHours,
    workspaceActivityLogs,
    seoIntelligence,
  ] = await Promise.all([
    getWorkspaceDiscoveryStats(session.userId as string, workspace.id),
    listWorkspaceDiscoveryArchive(session.userId as string, workspace.id, 10),
    getMaxDiscoveryRuns(),
    getBrandMemoryRescrapeLimit(),
    getIdeationMaxContentCount(),
    getContentWordCountLimits(),
    getDefaultScheduleDelayHours(),
    listWorkspaceActivityLogs(session.userId as string, workspace.id, 500),
    // SEO Intelligence: fetch real DataForSEO keyword data stored in DB
    (async () => {
      const [competitorKeywords, keywordOpportunities, serpAnalyses] = await Promise.all([
        prisma.competitorKeyword.findMany({
          where: { workspaceId: workspace.id },
          orderBy: [{ competitorDomain: 'asc' }, { searchVolume: 'desc' }],
        }),
        prisma.keywordOpportunity.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { opportunityScore: 'desc' },
        }),
        prisma.serpAnalysis.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, keyword: true, analysis: true, createdAt: true },
        }),
      ]);
      // Group competitor keywords by domain
      const byDomain: Record<string, typeof competitorKeywords> = {};
      const domainScans: Record<string, Date> = {};
      for (const kw of competitorKeywords) {
        if (!byDomain[kw.competitorDomain]) byDomain[kw.competitorDomain] = [];
        byDomain[kw.competitorDomain].push(kw);
        if (!domainScans[kw.competitorDomain] || kw.createdAt > domainScans[kw.competitorDomain]) {
          domainScans[kw.competitorDomain] = kw.createdAt;
        }
      }
      return { domainGroups: byDomain, domainScans, keywordOpportunities, serpAnalyses };
    })(),
  ]);

  const MONTHLY_LIMIT = 5;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [reportsThisMonth, reportHistory] = await Promise.all([
    prisma.strategicReport.count({
      where: { userId: session.userId as string, reportDate: { gte: startOfMonth } },
    }),
    prisma.strategicReport.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { reportDate: 'desc' },
      take: 20,
    }),
  ]);

  const insights = (workspace.audienceInsights as any) || {};
  const reportMissingData = missingReportRequirements(workspace.brandSummary, insights);

  const reportEligibility = {
    canGenerate: reportsThisMonth < MONTHLY_LIMIT && reportMissingData.length === 0,
    reportsThisMonth,
    remainingReports: MONTHLY_LIMIT - reportsThisMonth,
    missingData: reportMissingData,
  };

  const autopilotState = await getAutopilotState(workspace.id);
  const narrativeResult = await getNarrative(workspace.id);
  const narrativeData = narrativeResult.ok ? narrativeResult : null;
  const autopilotPolicy = ('policy' in autopilotState && autopilotState.policy) || null;
  const autopilotAgents = ('agents' in autopilotState && autopilotState.agents) || [];
  const autopilotRuns = ('runs' in autopilotState && autopilotState.runs) || [];
  const autopilotConnected =
    ('connectedPlatforms' in autopilotState && autopilotState.connectedPlatforms) || [];
  const autopilotHasSite =
    'hasSiteConnection' in autopilotState ? Boolean(autopilotState.hasSiteConnection) : false;
  const ideationReady =
    Boolean(workspace.brandSummary) &&
    Array.isArray(insights?.competitiveMatrices?.charts) &&
    insights.competitiveMatrices.charts.length > 0 &&
    Array.isArray(insights?.competitorKeywordsIntel?.competitors) &&
    insights.competitorKeywordsIntel.competitors.length > 0;

  const journeyFacts: WorkspaceFacts = {
    workspaceId: workspace.id,
    hasBrandSummary: Boolean(workspace.brandSummary),
    acceptedCompetitors: workspace.competitors.filter((c: any) => c.userDecision === 'ACCEPTED').length,
    totalCompetitors: workspace.competitors.length,
    matrixCharts: Array.isArray((workspace.audienceInsights as any)?.competitiveMatrices?.charts)
      ? (workspace.audienceInsights as any).competitiveMatrices.charts.length
      : 0,
    keywordCompetitors: Array.isArray((workspace.audienceInsights as any)?.competitorKeywordsIntel?.competitors)
      ? (workspace.audienceInsights as any).competitorKeywordsIntel.competitors.length
      : 0,
    storylines: narrativeData?.narrative?.storylines?.length ?? 0,
    hasChannel: autopilotConnected.length > 0 || autopilotHasSite,
    channelLabel:
      autopilotConnected.length > 0
        ? autopilotConnected.map((c) => c.platform).join(', ')
        : autopilotHasSite
          ? 'Website'
          : null,
    autopilotEnabled: Boolean(autopilotPolicy?.enabled),
    publishedCount: workspace.contentItems.filter((i: any) => i.status === 'PUBLISHED').length,
    scheduledCount: workspace.contentItems.filter((i: any) => i.status === 'SCHEDULED').length,
  };
  // The setup chain names its sentences; this is where they become words.
  const tj = await getTranslations('journey');
  const tg = await getTranslations('journeyGuide');

  const journey = buildJourney(journeyFacts);
  const gates = tabGate(journeyFacts);

  const requestedTab = resolveTab(resolvedSearchParams.tab);
  const brand = (workspace.brandSummary as any) || {};
  const initialMatrices =
    ((workspace.audienceInsights as any)?.competitiveMatrices as any) || null;
  const initialKeywordPayload =
    ((workspace.audienceInsights as any)?.competitorKeywordsIntel as any) || null;
  const initialOfferingsPayload =
    ((workspace.audienceInsights as any)?.productsServicesIntel as any) || null;
  const initialBrandAssetsPayload =
    ((workspace.audienceInsights as any)?.brandAssets as any) || null;
  const acceptedCompetitors = workspace.competitors.filter((item: any) => item.userDecision === 'ACCEPTED').length;

  const matricesTokenUsage = (initialMatrices?.token_usage as TokenUsageLike) || null;
  const keywordsTokenUsage = (initialKeywordPayload?.token_usage as TokenUsageLike) || null;
  const offeringsTokenUsage = (initialOfferingsPayload?.token_usage as TokenUsageLike) || null;
  const brandAssetsTokenUsage = (initialBrandAssetsPayload?.token_usage as TokenUsageLike) || null;

  const totalTrackedTokens =
    normalizeNumber(matricesTokenUsage?.lifetime_total_tokens) +
    normalizeNumber(keywordsTokenUsage?.lifetime_total_tokens) +
    normalizeNumber(offeringsTokenUsage?.lifetime_total_tokens) +
    normalizeNumber(brandAssetsTokenUsage?.lifetime_total_tokens);

  const trackedAiRuns =
    normalizeNumber(matricesTokenUsage?.runs) +
    normalizeNumber(keywordsTokenUsage?.runs) +
    normalizeNumber(offeringsTokenUsage?.runs) +
    normalizeNumber(brandAssetsTokenUsage?.runs);

  const estimatedCostUsd =
    estimateUsageCostUsd(matricesTokenUsage) +
    estimateUsageCostUsd(keywordsTokenUsage) +
    estimateUsageCostUsd(offeringsTokenUsage) +
    estimateUsageCostUsd(brandAssetsTokenUsage);

  const progressReport = buildWorkspaceProgressReport({
    workspace: {
      createdAt: workspace.createdAt,
      brandSummary: workspace.brandSummary,
      audienceInsights: workspace.audienceInsights,
      contentItems: workspace.contentItems.map((item: any) => ({
        status: item.status,
        channel: item.channel,
      })),
      competitors: workspace.competitors.map((item: any) => ({
        userDecision: item.userDecision,
      })),
    },
    activityLogs: workspaceActivityLogs,
  });
  const activeTab = requestedTab === 'progress' && !progressReport ? 'pipeline' : requestedTab;

  if (activeTab === 'progress' && progressReport) {
    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'EVOLUTION_REPORT_VIEWED',
      detail: {
        reportType: progressReport.report_type,
        generatedAt: progressReport.report_generated_at,
        timeWindowDays: progressReport.time_window_days,
      },
    });
  }

  // Ordered by the dependency chain, not by feature age: you cannot ideate
  // before keywords exist, so Ideation must not sit first in the strip.
  const tabItems = [
    {
      key: 'strategy',
      label: t('tabs.strategyLabel'),
      helper: t('tabs.strategyHelper', { count: initialBrandAssetsPayload?.summary?.asset_count || 0 }),
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      key: 'matrices',
      label: t('tabs.matricesLabel'),
      helper: t('tabs.matricesHelper', { count: initialMatrices?.charts?.length || 0 }),
      icon: <LineChart className="h-4 w-4" />,
    },
    {
      key: 'keywords',
      label: t('tabs.keywordsLabel'),
      helper: t('tabs.keywordsHelper', { count: initialKeywordPayload?.competitors?.length || 0 }),
      icon: <Tags className="h-4 w-4" />,
    },
    {
      key: 'narrative',
      label: t('tabs.narrativeLabel'),
      helper: t('tabs.narrativeHelper', { count: narrativeData?.narrative?.storylines?.length || 0 }),
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      key: 'offerings',
      label: t('tabs.offeringsLabel'),
      helper: t('tabs.offeringsHelper', {
        count: initialOfferingsPayload?.client_offerings?.offerings?.length || 0,
      }),
      icon: <Package className="h-4 w-4" />,
    },
    {
      key: 'seo',
      label: t('tabs.seoLabel'),
      helper: t('tabs.seoHelper', { count: seoIntelligence.keywordOpportunities.length }),
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      key: 'ideation',
      label: t('tabs.ideationLabel'),
      helper: t('tabs.ideationHelper'),
      icon: <Lightbulb className="h-4 w-4" />,
    },
    {
      key: 'pipeline',
      label: t('tabs.pipelineLabel'),
      helper: t('tabs.pipelineHelper', { count: workspace.contentItems.length }),
      icon: <ListTodo className="h-4 w-4" />,
    },
    {
      key: 'calendar',
      label: t('tabs.calendarLabel'),
      helper: t('tabs.calendarHelper'),
      icon: <CalendarDays className="h-4 w-4" />,
    },
    {
      key: 'autopilot',
      label: t('tabs.autopilotLabel'),
      helper: autopilotPolicy?.enabled
        ? t('tabs.autopilotHelperOn', { posts: autopilotPolicy.postsPerWeek })
        : t('tabs.autopilotHelperOff'),
      icon: <Bot className="h-4 w-4" />,
    },
    {
      key: 'reports',
      label: t('tabs.reportsLabel'),
      helper: t('tabs.reportsHelper', { count: reportEligibility.remainingReports }),
      icon: <FileText className="h-4 w-4" />,
    },
    ...(progressReport
      ? [
          {
            key: 'progress',
            label: t('tabs.progressLabel'),
            helper: t('tabs.progressHelper', {
              before: progressReport.maturity.before_stage,
              now: progressReport.maturity.now_stage,
            }),
            icon: <BarChart3 className="h-4 w-4" />,
          },
        ]
      : []),
  ];


  const loop = buildLoop(
    journey,
    gates,
    tabItems.map((item) => item.key),
    workspace.contentItems.length > 0,
  );

  // Setup problems that used to be invisible: a Gemini outage during
  // extraction left the workspace looking like a site with no competitors,
  // with nothing anywhere saying the AI provider had failed.
  // Warnings the workspace has since outgrown are dropped: re-running discovery
  // from Market Matrices fixes the competitor warning, and a banner that stays
  // after the problem is gone is just noise.
  const extractionWarnings = activeSetupWarnings((insights as any)?.extraction?.warnings, {
    competitorCount: workspace.competitors.length,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      {extractionWarnings.length > 0 && (
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-amber-800">
              {t('warningsTitle')}
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-ink-800">
              {/* A known code becomes a sentence here, at the moment it is
                  read. Anything else is text stored by an older build and is
                  shown as it was written. */}
              {extractionWarnings.map((w) => (
                <li key={w}>{isSetupWarningCode(w) ? t(`warnings.${w}`) : w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="border border-ink-200 bg-white">
        <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/growth"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-ink-400 hover:text-ink-900"
            >
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {t('back')}
            </Link>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-ink-950 font-display text-[16px] font-bold uppercase text-signal">
                {workspace.name.substring(0, 2)}
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-display text-[26px] font-bold tracking-tight text-ink-900 sm:text-[32px]">
                  {workspace.name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-600">
                  {workspace.websiteUrl && (
                    <a
                      href={workspace.websiteUrl.startsWith('http') ? workspace.websiteUrl : `https://${workspace.websiteUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-ink-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <bdi>{workspace.websiteUrl.replace(/^https?:\/\//, '')}</bdi>
                    </a>
                  )}
                  {brand.industry && (
                    <span className="font-mono text-[11px] uppercase tracking-widest text-ink-400">{brand.industry}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-3 lg:items-end">
            <Link
              href={{ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'autopilot' } }}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold ${
                autopilotAgents.some((a) => a.enabled)
                  ? 'bg-signal text-signal-ink hover:bg-ink-900 hover:text-white'
                  : 'bg-ink-900 text-white hover:bg-ink-800'
              }`}
            >
              <Bot className="h-4 w-4" />
              {autopilotPolicy?.enabled
                ? t('autopilotOn', { posts: autopilotPolicy.postsPerWeek })
                : t('autopilotOff')}
            </Link>
            <Link
              href={{ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'ideation' } }}
              className="inline-flex items-center justify-center gap-2 border border-ink-200 px-4 py-2.5 text-[13px] font-medium text-ink-900 hover:border-ink-400"
            >
              <Sparkles className="h-4 w-4" />
              {t('ideateByHand')}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-3 lg:grid-cols-7">
          <StatChip label={t('statCompetitors')} value={format.number(acceptedCompetitors)} />
          <StatChip label={t('statContent')} value={format.number(workspace.contentItems.length)} />
          <StatChip
            label={t('statDiscoveryRuns')}
            value={t('statDiscoveryValue', {
              used: discoveryStats.usedRuns,
              total: discoveryStats.usedRuns + discoveryStats.remainingRuns,
            })}
          />
          <StatChip label={t('statAiCalls')} value={format.number(trackedAiRuns)} />
          <StatChip label={t('statAiTokens')} value={format.number(totalTrackedTokens)} />
          <StatChip label={t('statEstCost')} value={format.number(estimatedCostUsd, {
              /* Quoted in USD in both languages; only the digits and the
                 grouping follow the locale. */
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            })} />
          <div className="flex items-center gap-2 bg-white px-4 py-3 font-mono text-[10.5px] uppercase tracking-widest text-ink-400">
            <Coins className="h-3.5 w-3.5 shrink-0" />
            {t('trackedNote')}
          </div>
        </div>
      </div>

      {/* ── SETUP GUIDE ─────────────────────────────────────────── */}
      <JourneyGuide workspaceId={workspace.id} journey={journey} />

      {/* ── THE LOOP ────────────────────────────────────────────── */}
      <LoopRail
        workspaceId={workspace.id}
        stages={loop}
        activeStage={stageForTab(activeTab)}
        activeTab={activeTab}
        tabs={tabItems.map((item) => {
          const gate = gates[item.key];
          return {
            key: item.key,
            label: item.label,
            title: gate ? t('tabTitleGated', { helper: item.helper, gate: tj(gate.key, gate.values) }) : item.helper,
            icon: item.icon,
            gated: Boolean(gate),
            live: item.key === 'autopilot' && Boolean(autopilotPolicy?.enabled),
          };
        })}
        names={Object.fromEntries(STAGES.map((st) => [st.id, t(`loop.${st.id}.name`)])) as Record<StageId, string>}
        numbers={
          Object.fromEntries(loop.map((st) => [st.id, format.number(st.order, { minimumIntegerDigits: 2 })])) as Record<
            StageId,
            string
          >
        }
        subs={Object.fromEntries(STAGES.map((st) => [st.id, t(`loop.${st.id}.sub`)])) as Record<StageId, string>}
        stateLabels={{
          done: t('loop.state.done'),
          next: t('loop.state.next'),
          open: t('loop.state.open'),
          locked: t('loop.state.locked'),
        }}
        navLabel={t('loop.tabsLabel')}
        stagesLabel={t('loop.label')}
      />

      {/* ── ACTIVE TAB CONTENT ────────────────────────────────────── */}
      {gates[activeTab] && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-5 py-3">
          <p className="text-[13px] text-amber-900">
            <span className="font-semibold">
              {tg('gateBlocked', { reason: tj(gates[activeTab]!.key, gates[activeTab]!.values) })}
            </span>{' '}
            {tg('gateConsequence')}
          </p>
          {journey.next && (
            <Link
              href={journey.next.href as never}
              className="inline-flex shrink-0 items-center gap-2 bg-amber-900 px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-amber-800"
            >
              {tj(journey.next.action.key, journey.next.action.values)}{' '}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </Link>
          )}
        </div>
      )}

      <div className="min-h-[50vh] border border-ink-200 bg-white p-6 md:p-8">
        {activeTab === 'strategy' && (
          <BrandMemoryTab
            workspace={workspace}
            maxRescrapeRuns={maxRescrapeRuns}
          />
        )}
        {activeTab === 'progress' && progressReport && (
          <ProgressReportTab report={progressReport} />
        )}
        {activeTab === 'matrices' && (
          <CompetitiveMatricesTab
            workspaceId={workspace.id}
            initialMatrices={initialMatrices}
            initialCompetitors={workspace.competitors.map((item: any) => ({
              id: item.id,
              name: item.name,
              domain: item.domain,
              description: item.description,
              category: item.category,
              audienceGuess: item.audienceGuess,
              type: item.type,
              userDecision: item.userDecision,
              source: item.source,
            }))}
            discoveryMeta={{
              usedRuns: discoveryStats.usedRuns,
              remainingRuns: discoveryStats.remainingRuns,
              maxRuns: maxDiscoveryRuns,
            }}
            discoveryArchive={discoveryArchive}
          />
        )}
        {activeTab === 'keywords' && (
          <CompetitorKeywordsTab
            workspaceId={workspace.id}
            initialPayload={initialKeywordPayload}
          />
        )}
        {activeTab === 'narrative' && (
          <NarrativeTab
            workspaceId={workspace.id}
            narrative={(narrativeData?.narrative as never) ?? null}
            evidence={(narrativeData?.evidence as never) ?? []}
          />
        )}

        {activeTab === 'offerings' && (
          <ProductsServicesTab
            workspaceId={workspace.id}
            initialPayload={initialOfferingsPayload}
          />
        )}
        {activeTab === 'ideation' && (
          <IdeationTab
            workspace={workspace}
            maxIdeaCount={maxIdeationItems}
            maxImageCount={3}
            wordCountLimits={wordCountLimits}
          />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab
            workspace={workspace}
            items={workspace.contentItems}
            wordCountLimits={wordCountLimits}
            defaultScheduleDelayHours={defaultScheduleDelayHours}
          />
        )}
        {activeTab === 'seo' && (
          <SeoIntelligenceTab
            workspaceId={workspace.id}
            acceptedCompetitorDomains={
              workspace.competitors
                .filter((c: any) => c.userDecision === 'ACCEPTED' && c.domain)
                .map((c: any) => c.domain!)
            }
            initialDomainGroups={seoIntelligence.domainGroups}
            initialDomainScans={seoIntelligence.domainScans}
            initialOpportunities={seoIntelligence.keywordOpportunities}
            initialSerpAnalyses={seoIntelligence.serpAnalyses}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarTab workspaceId={workspace.id} />
        )}
        {activeTab === 'reports' && (
          <ReportsTab
            workspaceId={workspace.id}
            initialEligibility={reportEligibility}
            initialHistory={reportHistory}
          />
        )}
        {activeTab === 'autopilot' && (
          <AutopilotTab
            workspaceId={workspace.id}
            initialPolicy={autopilotPolicy ?? autopilotAgents[0] ?? null}
            initialAgents={autopilotAgents}
            initialRuns={autopilotRuns}
            connectedPlatforms={autopilotConnected}
            hasSiteConnection={autopilotHasSite}
            storylines={(narrativeData?.narrative?.storylines ?? []).map((s: any) => ({
              id: s.id,
              claim: s.claim,
            }))}
            ideationReady={ideationReady}
          />
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-ink-400">{label}</p>
      <p className="mt-1 font-display text-[18px] font-semibold text-ink-900">{value}</p>
    </div>
  );
}

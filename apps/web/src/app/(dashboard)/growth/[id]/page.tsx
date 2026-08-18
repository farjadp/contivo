import { getSession } from '@/lib/auth';
import { getWorkspaceArchiveState } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
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
} from 'lucide-react';
import Link from 'next/link';
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
import { getAutopilotState } from '@/app/actions/autopilot';

export const metadata = { title: 'Workspace Dashboard' };

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

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
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
    'calendar',
    'seo',
    'reports',
    'autopilot',
  ]);
  if (!value || !allowed.has(value)) return 'pipeline';
  return value;
}


export default async function WorkspacePage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/sign-in');

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
    redirect('/growth');
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
  const reportMissingData: string[] = [];
  if (!workspace.brandSummary) reportMissingData.push('Brand Memory');
  if (!insights?.competitiveMatrices?.charts || insights.competitiveMatrices.charts.length < 5)
    reportMissingData.push('Market Matrices (5 charts required)');
  if (!insights?.competitorKeywordsIntel?.competitors?.length)
    reportMissingData.push('Competitor Keywords');
  if (!insights?.productsServicesIntel?.client_offerings?.offerings?.length)
    reportMissingData.push('Products & Services');

  const reportEligibility = {
    canGenerate: reportsThisMonth < MONTHLY_LIMIT && reportMissingData.length === 0,
    reportsThisMonth,
    remainingReports: MONTHLY_LIMIT - reportsThisMonth,
    missingData: reportMissingData,
  };

  const autopilotState = await getAutopilotState(workspace.id);
  const autopilotPolicy = ('policy' in autopilotState && autopilotState.policy) || null;
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

  const tabItems = [
    {
      key: 'pipeline',
      label: 'Content Pipeline',
      helper: `${workspace.contentItems.length} items`,
      icon: <ListTodo className="h-4 w-4" />,
    },
    {
      key: 'ideation',
      label: 'Ideation Station',
      helper: 'AI ideas + drafts',
      icon: <Lightbulb className="h-4 w-4" />,
    },
    {
      key: 'strategy',
      label: 'Brand Memory',
      helper: `${initialBrandAssetsPayload?.summary?.asset_count || 0} assets`,
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      key: 'calendar',
      label: 'Publishing Calendar',
      helper: `Manage your scheduled content`,
      icon: <CalendarDays className="h-4 w-4" />,
    },
    ...(progressReport
      ? [
          {
            key: 'progress',
            label: 'Evolution Report',
            helper: `${progressReport.maturity.before_stage} → ${progressReport.maturity.now_stage}`,
            icon: <BarChart3 className="h-4 w-4" />,
          },
        ]
      : []),
    {
      key: 'matrices',
      label: 'Market Matrices',
      helper: `${initialMatrices?.charts?.length || 0} charts`,
      icon: <LineChart className="h-4 w-4" />,
    },
    {
      key: 'keywords',
      label: 'Competitor Keywords',
      helper: `${initialKeywordPayload?.competitors?.length || 0} analyzed`,
      icon: <Tags className="h-4 w-4" />,
    },
    {
      key: 'offerings',
      label: 'Products & Services',
      helper: `${initialOfferingsPayload?.client_offerings?.offerings?.length || 0} client offers`,
      icon: <Package className="h-4 w-4" />,
    },
    {
      key: 'seo',
      label: 'SEO Intelligence',
      helper: `${seoIntelligence.keywordOpportunities.length} opportunities`,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      key: 'reports',
      label: 'Reports',
      helper: `${reportEligibility.remainingReports} remaining this month`,
      icon: <FileText className="h-4 w-4" />,
    },
    {
      key: 'autopilot',
      label: 'Autopilot',
      helper: autopilotPolicy?.enabled
        ? `ON · ${autopilotPolicy.postsPerWeek}/week`
        : 'Hands-off publishing',
      icon: <Bot className="h-4 w-4" />,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="border border-ink-200 bg-white">
        <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/growth"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-ink-400 hover:text-ink-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Workspaces
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
                      {workspace.websiteUrl.replace(/^https?:\/\//, '')}
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
              href={`/growth/${workspace.id}?tab=autopilot`}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold ${
                autopilotPolicy?.enabled
                  ? 'bg-signal text-signal-ink hover:bg-ink-900 hover:text-white'
                  : 'bg-ink-900 text-white hover:bg-ink-800'
              }`}
            >
              <Bot className="h-4 w-4" />
              {autopilotPolicy?.enabled ? `Autopilot on · ${autopilotPolicy.postsPerWeek}/wk` : 'Turn on Autopilot'}
            </Link>
            <Link
              href={`/growth/${workspace.id}?tab=ideation`}
              className="inline-flex items-center justify-center gap-2 border border-ink-200 px-4 py-2.5 text-[13px] font-medium text-ink-900 hover:border-ink-400"
            >
              <Sparkles className="h-4 w-4" />
              Ideate by hand
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-3 lg:grid-cols-7">
          <StatChip label="Competitors" value={acceptedCompetitors.toLocaleString()} />
          <StatChip label="Content" value={workspace.contentItems.length.toLocaleString()} />
          <StatChip label="Discovery runs" value={`${discoveryStats.usedRuns} / ${discoveryStats.usedRuns + discoveryStats.remainingRuns}`} />
          <StatChip label="AI calls" value={trackedAiRuns.toLocaleString()} />
          <StatChip label="AI tokens" value={totalTrackedTokens.toLocaleString()} />
          <StatChip label="Est. cost" value={formatUsd(estimatedCostUsd)} />
          <div className="flex items-center gap-2 bg-white px-4 py-3 font-mono text-[10.5px] uppercase tracking-widest text-ink-400">
            <Coins className="h-3.5 w-3.5 shrink-0" />
            tracked modules only
          </div>
        </div>
      </div>

      {/* ── TABS ────────────────────────────────────────────────── */}
      <nav className="flex flex-wrap gap-x-1 border-b border-ink-200" aria-label="Tabs">
        {tabItems.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <Link
              key={item.key}
              href={`/growth/${workspace.id}?tab=${item.key}`}
              className={`group relative flex items-center gap-2 px-3.5 py-3 text-[13px] transition-colors ${
                isActive ? 'font-semibold text-ink-900' : 'text-ink-600 hover:text-ink-900'
              }`}
              title={item.helper}
            >
              <span className={isActive ? 'text-ink-900' : 'text-ink-400 group-hover:text-ink-900'}>{item.icon}</span>
              {item.label}
              {item.key === 'autopilot' && autopilotPolicy?.enabled && (
                <span className="ml-1 h-1.5 w-1.5 bg-signal" />
              )}
              <span
                aria-hidden
                className={`absolute inset-x-0 -bottom-px h-[2px] ${isActive ? 'bg-ink-900' : 'bg-transparent'}`}
              />
            </Link>
          );
        })}
      </nav>

      {/* ── ACTIVE TAB CONTENT ────────────────────────────────────── */}
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
            initialPolicy={autopilotPolicy}
            initialRuns={autopilotRuns}
            connectedPlatforms={autopilotConnected}
            hasSiteConnection={autopilotHasSite}
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

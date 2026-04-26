import { getSession } from '@/lib/auth';
import { getWorkspaceArchiveState } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
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
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 pt-2">
      {/* ── HERO HEADER ────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-[#FDFCF8] border-2 border-[#121212] p-6 md:p-10 shadow-[8px_8px_0px_#121212] rounded-none">

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          <div>
            <Link
              href="/growth"
              className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[#121212]/50 hover:text-[#121212] mb-8 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Return
            </Link>
            <div className="flex items-center gap-5">
              <div className="h-16 w-16 bg-[#121212] flex items-center justify-center text-[#FDFCF8] font-black text-2xl uppercase shrink-0 border-2 border-[#121212]">
                {workspace.name.substring(0, 2)}
              </div>
              <div>
                <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-[#121212] mb-3">
                  {workspace.name}
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-widest text-[#121212]/60">
                  {workspace.websiteUrl && (
                    <a href={workspace.websiteUrl.startsWith('http') ? workspace.websiteUrl : `https://${workspace.websiteUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#C04C36] hover:bg-[#C04C36]/10 px-3 py-1 border border-[#C04C36] transition-colors rounded-none">
                      <ExternalLink className="w-3.5 h-3.5" />
                      {workspace.websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {brand.industry && (
                    <span className="px-3 py-1 bg-[#EFECE5] text-[#121212]/80 border border-[#121212]/10 rounded-none">
                      {brand.industry}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-4 lg:items-end">
            <div className="flex flex-wrap lg:justify-end gap-2 w-full lg:w-auto">
              <StatChip label="AI Tokens" value={totalTrackedTokens.toLocaleString()} />
              <div className="border border-[#121212]/20 bg-[#FDFCF8] px-4 py-3 min-w-[130px] flex-1 lg:flex-none">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#121212]/50">Cost</p>
                <p className="mt-1 text-lg font-black text-[#121212]">{formatUsd(estimatedCostUsd)}</p>
              </div>
            </div>

            <Link
              href={`/growth/${workspace.id}?tab=ideation`}
              className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#C04C36] text-[#FDFCF8] px-6 py-4 text-sm font-bold uppercase tracking-widest hover:bg-[#121212] transition-colors rounded-none"
            >
              <Sparkles className="w-4 h-4" />
              Generate Content
            </Link>
          </div>
        </div>

        <div className="relative z-10 mt-8 pt-8 border-t border-[#121212]/10 grid gap-3 grid-cols-2 md:grid-cols-5">
          <StatChip label="Competitors" value={acceptedCompetitors.toLocaleString()} />
          <StatChip label="Runs Used" value={discoveryStats.usedRuns.toLocaleString()} />
          <StatChip label="Runs Left" value={discoveryStats.remainingRuns.toLocaleString()} />
          <StatChip label="AI Calls" value={trackedAiRuns.toLocaleString()} />
          <StatChip label="Content" value={workspace.contentItems.length.toLocaleString()} />
        </div>

        <div className="mt-6 border border-[#121212]/10 bg-[#EFECE5] xl:w-fit px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#121212]/60 flex items-center gap-2 rounded-none">
          <Coins className="h-4 w-4 shrink-0 text-[#121212]" />
          Costs estimated from tracked AI modules.
        </div>
      </div>

      {/* ── NAVIGATION TABS ────────────────────────────────────── */}
      <div className="border border-[#121212]/20 bg-[#FDFCF8] p-3 shadow-[4px_4px_0px_#121212] rounded-none">
        <nav className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tabs">
          {tabItems.map((item) => {
            const isActive = activeTab === item.key;

            return (
              <Link
                key={item.key}
                href={`/growth/${workspace.id}?tab=${item.key}`}
                className={`group relative overflow-hidden px-5 py-4 transition-colors rounded-none border ${
                  isActive
                    ? 'bg-[#121212] text-[#FDFCF8] border-[#121212]'
                    : 'bg-[#FDFCF8] text-[#121212] border-[#121212]/10 hover:bg-[#EFECE5] hover:border-[#121212]/30'
                }`}
              >
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div>
                    <p className={`inline-flex items-center gap-2.5 font-bold uppercase tracking-widest text-sm ${isActive ? 'text-[#FDFCF8]' : 'text-[#121212] group-hover:text-[#C04C36] transition-colors'}`}>
                      {item.icon}
                      {item.label}
                    </p>
                    <p className={`mt-1.5 text-[10px] font-bold tracking-widest uppercase ${isActive ? 'text-[#FDFCF8]/50' : 'text-[#121212]/40'}`}>
                      {item.helper}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="bg-[#C04C36] text-[#FDFCF8] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-none">
                      Active
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── ACTIVE TAB CONTENT ────────────────────────────────────── */}
      <div className="mt-8 border border-[#121212]/20 bg-[#FDFCF8] p-6 md:p-10 shadow-[4px_4px_0px_#121212] rounded-none min-h-[50vh]">
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
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#121212]/10 bg-[#EFECE5] px-4 py-3 flex-1 lg:flex-none min-w-[130px] rounded-none">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#121212]/50">{label}</p>
      <p className="mt-1 text-lg font-black text-[#121212]">{value}</p>
    </div>
  );
}

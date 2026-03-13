import { getSession } from '@/lib/auth';
import { getWorkspaceArchiveState } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Coins,
  ExternalLink,
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
  const acceptedCompetitors = workspace.competitors.filter((item) => item.userDecision === 'ACCEPTED').length;

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
      contentItems: workspace.contentItems.map((item) => ({
        status: item.status,
        channel: item.channel,
      })),
      competitors: workspace.competitors.map((item) => ({
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
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 pt-2">
      {/* ── BENTO HERO HEADER ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[32px] bg-white border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.03)] p-6 md:p-10">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-gradient-to-br from-[#2B2DFF]/10 to-[#00E5FF]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          <div>
            <Link
              href="/growth"
              className="inline-flex items-center gap-2 text-sm font-bold text-gray-400 hover:text-[#2B2DFF] mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Workspaces
            </Link>
            <div className="flex items-center gap-5">
              <div className="h-16 w-16 rounded-[20px] bg-gray-900 flex items-center justify-center text-white font-black text-2xl uppercase shadow-xl shrink-0">
                {workspace.name.substring(0, 2)}
              </div>
              <div>
                <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">
                  {workspace.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 font-bold">
                  {workspace.websiteUrl && (
                    <a href={workspace.websiteUrl.startsWith('http') ? workspace.websiteUrl : `https://${workspace.websiteUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#2B2DFF] hover:bg-indigo-50 px-3 py-1 rounded-xl transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" />
                      {workspace.websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {brand.industry && (
                    <span className="px-3 py-1 bg-gray-50 text-gray-500 rounded-xl">
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
              <div className="rounded-[16px] border border-emerald-100 bg-emerald-50 px-4 py-3 min-w-[130px] flex-1 lg:flex-none">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Cost</p>
                <p className="mt-1 text-lg font-black text-emerald-900">{formatUsd(estimatedCostUsd)}</p>
              </div>
            </div>

            <Link
              href={`/growth/${workspace.id}?tab=ideation`}
              className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#2B2DFF] text-white px-6 py-4 rounded-2xl text-sm font-bold shadow-xl shadow-indigo-600/20 hover:scale-105 transition-all"
            >
              <Sparkles className="w-5 h-5 text-indigo-200" />
              Generate Content
            </Link>
          </div>
        </div>

        <div className="relative z-10 mt-8 pt-8 border-t border-gray-100 grid gap-3 grid-cols-2 md:grid-cols-5">
          <StatChip label="Competitors" value={acceptedCompetitors.toLocaleString()} />
          <StatChip label="Runs Used" value={discoveryStats.usedRuns.toLocaleString()} />
          <StatChip label="Runs Left" value={discoveryStats.remainingRuns.toLocaleString()} />
          <StatChip label="AI Calls" value={trackedAiRuns.toLocaleString()} />
          <StatChip label="Content" value={workspace.contentItems.length.toLocaleString()} />
        </div>

        <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/50 xl:w-fit px-4 py-3 text-xs font-semibold text-amber-700/80 flex items-center gap-2">
          <Coins className="h-4 w-4 shrink-0" />
          Costs estimated from tracked AI modules.
        </div>
      </div>

      {/* ── BENTO NAVIGATION TABS ────────────────────────────────────── */}
      <div className="rounded-[32px] border border-gray-100 bg-white p-3 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <nav className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tabs">
          {tabItems.map((item) => {
            const isActive = activeTab === item.key;

            return (
              <Link
                key={item.key}
                href={`/growth/${workspace.id}?tab=${item.key}`}
                className={`group relative overflow-hidden rounded-[24px] px-5 py-4 transition-all hover:-translate-y-0.5 ${
                  isActive
                    ? 'bg-gray-900 text-white shadow-xl shadow-gray-900/10 border border-gray-900/50'
                    : 'bg-white text-gray-700 border border-gray-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:border-gray-200'
                }`}
              >
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div>
                    <p className={`inline-flex items-center gap-2.5 font-bold ${isActive ? 'text-white' : 'text-gray-900 group-hover:text-[#2B2DFF] transition-colors'}`}>
                      {item.icon}
                      {item.label}
                    </p>
                    <p className={`mt-1.5 text-[11px] font-bold tracking-wide uppercase ${isActive ? 'text-gray-400' : 'text-gray-400'}`}>
                      {item.helper}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="rounded-xl bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
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
      <div className="mt-5 rounded-[32px] border border-gray-100 bg-white p-6 md:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.03)] min-h-[50vh]">
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
            initialCompetitors={workspace.competitors.map((item) => ({
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
                .filter((c) => c.userDecision === 'ACCEPTED' && c.domain)
                .map((c) => c.domain!)
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
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-gray-100 bg-gray-50/50 px-4 py-3 flex-1 lg:flex-none min-w-[130px]">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-black text-gray-900">{value}</p>
    </div>
  );
}

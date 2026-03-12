import { getSession } from '@/lib/auth';
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
} from 'lucide-react';
import Link from 'next/link';
import { BrandMemoryTab } from './_components/BrandMemoryTab';
import { IdeationTab } from './_components/IdeationTab';
import { PipelineTab } from './_components/PipelineTab';
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
  getIdeationMaxContentCount,
} from '@/lib/app-settings';
import { CompetitiveMatricesTab } from './_components/CompetitiveMatricesTab';
import { CompetitorKeywordsTab } from './_components/CompetitorKeywordsTab';
import { ProductsServicesTab } from './_components/ProductsServicesTab';
import { buildWorkspaceProgressReport } from '@/lib/workspace-progress';
import { ProgressReportTab } from './_components/ProgressReportTab';

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

  const [discoveryStats, discoveryArchive, maxDiscoveryRuns, maxRescrapeRuns, maxIdeationItems, wordCountLimits, workspaceActivityLogs] = await Promise.all([
    getWorkspaceDiscoveryStats(session.userId as string, workspace.id),
    listWorkspaceDiscoveryArchive(session.userId as string, workspace.id, 10),
    getMaxDiscoveryRuns(),
    getBrandMemoryRescrapeLimit(),
    getIdeationMaxContentCount(),
    getContentWordCountLimits(),
    listWorkspaceActivityLogs(session.userId as string, workspace.id, 500),
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

  const totalPromptTokens =
    normalizeNumber(matricesTokenUsage?.lifetime_prompt_tokens) +
    normalizeNumber(keywordsTokenUsage?.lifetime_prompt_tokens) +
    normalizeNumber(offeringsTokenUsage?.lifetime_prompt_tokens) +
    normalizeNumber(brandAssetsTokenUsage?.lifetime_prompt_tokens);
  const totalCompletionTokens =
    normalizeNumber(matricesTokenUsage?.lifetime_completion_tokens) +
    normalizeNumber(keywordsTokenUsage?.lifetime_completion_tokens) +
    normalizeNumber(offeringsTokenUsage?.lifetime_completion_tokens) +
    normalizeNumber(brandAssetsTokenUsage?.lifetime_completion_tokens);
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
      isExternalLink: true,
      href: `/growth/${workspace.id}/calendar`
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
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white via-white to-gray-50 p-6 md:p-7">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div>
          <Link
            href="/growth"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#121212] mb-4 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Workspaces
          </Link>
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-[#121212] flex items-center justify-center text-white font-bold text-xl uppercase shadow-md shrink-0">
              {workspace.name.substring(0, 2)}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[#121212] mb-1 flex items-center gap-3">
                {workspace.name}
              </h1>
              <div className="flex items-center gap-3 text-sm text-gray-500 font-medium">
                {workspace.websiteUrl && (
                  <a href={workspace.websiteUrl.startsWith('http') ? workspace.websiteUrl : `https://${workspace.websiteUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                    {workspace.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {brand.industry && (
                  <span className="hidden sm:inline-block px-2 py-0.5 bg-gray-100 rounded-md">
                    {brand.industry}
                  </span>
                )}
              </div>
            </div>
          </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 min-w-[155px]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">AI Tokens</p>
                <p className="mt-1 text-base font-bold text-[#121212]">{totalTrackedTokens.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 min-w-[155px]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Estimated Cost</p>
                <p className="mt-1 text-base font-bold text-emerald-900">{formatUsd(estimatedCostUsd)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 min-w-[155px]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Prompt Tokens</p>
                <p className="mt-1 text-base font-bold text-[#121212]">{totalPromptTokens.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 min-w-[155px]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Completion Tokens</p>
                <p className="mt-1 text-base font-bold text-[#121212]">{totalCompletionTokens.toLocaleString()}</p>
              </div>
            </div>

            <Link
              href={`/growth/${workspace.id}?tab=ideation`}
              className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#121212] text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg hover:bg-black hover:scale-[1.02] hover:shadow-xl transition-all"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Generate Ideas
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatChip label="Accepted Competitors" value={acceptedCompetitors.toLocaleString()} />
          <StatChip label="Discovery Runs Used" value={discoveryStats.usedRuns.toLocaleString()} />
          <StatChip label="Discovery Runs Left" value={discoveryStats.remainingRuns.toLocaleString()} />
          <StatChip label="Tracked AI Runs" value={trackedAiRuns.toLocaleString()} />
          <StatChip label="Content Items" value={workspace.contentItems.length.toLocaleString()} />
        </div>

        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Coins className="h-3.5 w-3.5" />
            Cost is estimated from tracked AI modules (Brand Assets, Market Matrices, Competitor Keywords, Products & Services) using model-rate mapping.
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-2">
        <nav className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Tabs">
          {tabItems.map((item) => {
            const isActive = activeTab === item.key;
            return item.isExternalLink ? (
              <a
                key={item.key}
                href={item.href!}
                className={`rounded-xl border px-3 py-3 text-sm transition ${
                  isActive
                    ? 'border-[#121212] bg-[#121212] text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="inline-flex items-center gap-2 font-bold">
                      {item.icon}
                      {item.label}
                    </p>
                    <p className={`mt-1 text-xs ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                      {item.helper}
                    </p>
                  </div>
                </div>
              </a>
            ) : (
              <Link
                key={item.key}
                href={`/growth/${workspace.id}?tab=${item.key}`}
                className={`rounded-xl border px-3 py-3 text-sm transition ${
                  isActive
                    ? 'border-[#121212] bg-[#121212] text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="inline-flex items-center gap-2 font-bold">
                      {item.icon}
                      {item.label}
                    </p>
                    <p className={`mt-1 text-xs ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                      {item.helper}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      Active
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
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
          <PipelineTab workspace={workspace} items={workspace.contentItems} wordCountLimits={wordCountLimits} />
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-[#121212]">{value}</p>
    </div>
  );
}

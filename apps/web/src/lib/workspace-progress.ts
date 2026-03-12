import type { ActivityLogEntry } from '@/lib/activity-log';

type ScorePair = {
  before: number;
  now: number;
  delta: number;
  delta_label: 'slight_progress' | 'meaningful_progress' | 'major_progress' | 'no_change' | 'decline';
};

type ProgressDimensionKey =
  | 'brand_understanding'
  | 'strategy_readiness'
  | 'market_intelligence'
  | 'content_system'
  | 'distribution_readiness'
  | 'optimization_maturity';

type BaselineSnapshot = {
  created_at: string;
  scores: Record<ProgressDimensionKey, number>;
  maturity_stage: string;
  metrics: {
    content_items: number;
    discovered_competitors: number;
    accepted_competitors: number;
    connected_channels: number;
    strategy_runs: number;
  };
};

export type WorkspaceProgressReport = {
  report_type: 'marketing_evolution';
  report_generated_at: string;
  baseline_created_at: string;
  time_window_days: number;
  report_name: 'Marketing Evolution Report';
  point_a_summary: string;
  point_b_summary: string;
  progress_delta: string;
  dimension_scores: Record<ProgressDimensionKey, ScorePair>;
  usage_summary: {
    days_since_signup: number;
    meaningful_sessions: number;
    strategy_runs: number;
    content_generated: number;
    approved_assets: number;
    published_assets: number;
    connected_channels: number;
    competitor_validations: number;
    refinements: number;
  };
  maturity: {
    before_stage: string;
    now_stage: string;
    before_average: number;
    now_average: number;
  };
  overall_score_before: number;
  overall_score_now: number;
  narrative_summary: string;
  next_best_action: string;
  milestone_triggers: string[];
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toDate(value: unknown): Date {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function toMaturityStage(avg: number): string {
  if (avg <= 2.5) return 'Level 1 — Unstructured';
  if (avg <= 4.5) return 'Level 2 — Foundation';
  if (avg <= 6.5) return 'Level 3 — Structured';
  if (avg <= 8.5) return 'Level 4 — Emerging Engine';
  return 'Level 5 — Optimization Ready';
}

function countByStatus(items: Array<{ status: string }>, status: string): number {
  return items.filter((item) => item.status === status).length;
}

const MEANINGFUL_ACTIONS = new Set([
  'COMPETITIVE_MATRICES_GENERATED',
  'COMPETITOR_REVIEW_SAVED',
  'COMPETITOR_MANUAL_EDIT_SAVED',
  'COMPETITOR_KEYWORDS_GENERATED',
  'COMPETITOR_DISCOVERY_RUN',
  'CONTENT_PIPELINE_ITEM_SAVED',
  'CONTENT_GENERATED_FROM_PIPELINE',
  'CONTENT_APPROVED',
  'CONTENT_PUBLISHED',
  'CONTENT_SCHEDULED',
  'CHANNEL_CONNECTED',
  'IDEATION_GENERATED',
  'PRODUCTS_SERVICES_INTEL_GENERATED',
  'BRAND_MEMORY_RESCRAPE_SUCCEEDED',
]);

function getMeaningfulSessionDays(logs: ActivityLogEntry[]): number {
  const keys = new Set<string>();
  for (const log of logs) {
    if (!MEANINGFUL_ACTIONS.has(log.action)) continue;
    keys.add(new Date(log.createdAt).toISOString().slice(0, 10));
  }
  return keys.size;
}

function countActions(logs: ActivityLogEntry[], actions: string[]): number {
  const set = new Set(actions);
  return logs.reduce((acc, log) => (set.has(log.action) ? acc + 1 : acc), 0);
}

function getDistinctConnectedChannels(logs: ActivityLogEntry[]): number {
  const channels = new Set<string>();
  for (const log of logs) {
    if (log.action !== 'CHANNEL_CONNECTED') continue;
    const platform = String((log.detail as any)?.platform || '').trim().toLowerCase();
    if (platform) channels.add(platform);
  }
  return channels.size;
}

function getOverallScore(scores: Record<ProgressDimensionKey, number>): number {
  const total =
    scores.brand_understanding * 0.2 +
    scores.strategy_readiness * 0.2 +
    scores.market_intelligence * 0.15 +
    scores.content_system * 0.2 +
    scores.distribution_readiness * 0.15 +
    scores.optimization_maturity * 0.1;
  return Number(total.toFixed(1));
}

function buildInitialScores(input: {
  brandSummary: any;
  contentItems: Array<{ status: string; channel: string | null }>;
  competitors: Array<{ userDecision?: string | null }>;
  insights: any;
  activityLogs: ActivityLogEntry[];
}): Record<ProgressDimensionKey, number> {
  const pillarsCount = Array.isArray(input.brandSummary?.pillars) ? input.brandSummary.pillars.length : 0;
  const offeringsCount = Array.isArray(input.insights?.productsServicesIntel?.client_offerings?.offerings)
    ? input.insights.productsServicesIntel.client_offerings.offerings.length
    : 0;
  const matricesCount = Array.isArray(input.insights?.competitiveMatrices?.charts)
    ? input.insights.competitiveMatrices.charts.length
    : 0;
  const keywordCompetitors = Array.isArray(input.insights?.competitorKeywordsIntel?.competitors)
    ? input.insights.competitorKeywordsIntel.competitors.length
    : 0;

  const totalCompetitors = input.competitors.length;
  const acceptedCompetitors = input.competitors.filter((item) => item.userDecision === 'ACCEPTED').length;
  const generatedCount =
    countByStatus(input.contentItems, 'GENERATED') +
    countByStatus(input.contentItems, 'EDITED') +
    countByStatus(input.contentItems, 'READY') +
    countByStatus(input.contentItems, 'SCHEDULED') +
    countByStatus(input.contentItems, 'PUBLISHING') +
    countByStatus(input.contentItems, 'PUBLISHED') +
    countByStatus(input.contentItems, 'EXPORTED');
  const savedCount = countActions(input.activityLogs, ['CONTENT_PIPELINE_ITEM_SAVED']);
  const approvedCount =
    countActions(input.activityLogs, ['CONTENT_APPROVED']) +
    countByStatus(input.contentItems, 'READY') +
    countByStatus(input.contentItems, 'SCHEDULED') +
    countByStatus(input.contentItems, 'PUBLISHING') +
    countByStatus(input.contentItems, 'PUBLISHED') +
    countByStatus(input.contentItems, 'EXPORTED');
  const exportedCount = countActions(input.activityLogs, ['CONTENT_PUBLISHED', 'CONTENT_SCHEDULED']) +
    countByStatus(input.contentItems, 'PUBLISHED') +
    countByStatus(input.contentItems, 'SCHEDULED') +
    countByStatus(input.contentItems, 'EXPORTED');
  const uniqueChannels = new Set(input.contentItems.map((item) => item.channel || '').filter(Boolean)).size;
  const channelsConnected = getDistinctConnectedChannels(input.activityLogs);
  const calendarUsed = countActions(input.activityLogs, ['CALENDAR_CREATED']) > 0;
  const strategyRuns =
    countActions(input.activityLogs, ['COMPETITIVE_MATRICES_GENERATED']) +
    countActions(input.activityLogs, ['BRAND_MEMORY_RESCRAPE_SUCCEEDED']);
  const ideationRuns = countActions(input.activityLogs, ['IDEATION_GENERATED']);
  const offeringsReviewed = countActions(input.activityLogs, ['PRODUCTS_SERVICES_INTEL_EDITED']) > 0;
  const keywordsGenerated = countActions(input.activityLogs, ['COMPETITOR_KEYWORDS_GENERATED']) > 0;

  const brandUnderstandingScore = clampScore(
    (input.brandSummary?.businessSummary ? 2 : 0) +
      (offeringsCount >= 1 ? 1 : 0) +
      (offeringsReviewed ? 1 : 0) +
      (input.brandSummary?.audience ? 2 : 0) +
      (input.brandSummary?.tone ? 2 : 0) +
      (input.brandSummary?.valueProposition ? 2 : 0),
  );

  const strategyReadinessScore = clampScore(
    (pillarsCount > 0 ? 2.5 : 0) +
      (strategyRuns > 0 ? 2.5 : 0) +
      (ideationRuns > 0 ? 2.5 : 0) +
      (matricesCount > 0 ? 2.5 : 0),
  );

  const marketIntelligenceScore = clampScore(
    (totalCompetitors >= 3 ? 2 : 0) +
      (acceptedCompetitors >= 3 ? 3 : acceptedCompetitors > 0 ? 1.5 : 0) +
      (keywordsGenerated || keywordCompetitors > 0 ? 2 : 0) +
      (matricesCount >= 1 ? 1.5 : 0) +
      (matricesCount >= 3 ? 1.5 : 0),
  );

  const generatedScore = Math.min(2.5, clampRatio(generatedCount / 20) * 2.5);
  const savedScore = Math.min(2.5, clampRatio(savedCount / 20) * 2.5);
  const approvedScore = Math.min(2.5, clampRatio(approvedCount / 20) * 2.5);
  const diversityScore = uniqueChannels >= 2 ? 2.5 : uniqueChannels >= 1 ? 1.25 : 0;
  const contentSystemScore = clampScore(generatedScore + savedScore + approvedScore + diversityScore);

  const channelScore = channelsConnected >= 2 ? 4 : channelsConnected === 1 ? 3 : 0;
  const calendarScore = calendarUsed ? 3 : 0;
  const publishScore = exportedCount >= 1 ? 3 : 0;
  const distributionReadinessScore = clampScore(channelScore + calendarScore + publishScore);

  const performanceData = countActions(input.activityLogs, ['PERFORMANCE_DATA_SYNCED']) > 0 ? 3 : 0;
  const insightsGenerated = matricesCount > 0 || keywordsGenerated ? 3 : 0;
  const gapsIdentified = (input.insights?.competitorKeywordsIntel?.content_gaps?.length || 0) > 0 ? 2 : 0;
  const recommendationGenerated = matricesCount > 0 || keywordsGenerated || offeringsCount > 0 ? 2 : 0;
  const optimizationScore = clampScore(
    performanceData + insightsGenerated + gapsIdentified + recommendationGenerated,
  );

  return {
    brand_understanding: brandUnderstandingScore,
    strategy_readiness: strategyReadinessScore,
    market_intelligence: marketIntelligenceScore,
    content_system: contentSystemScore,
    distribution_readiness: distributionReadinessScore,
    optimization_maturity: optimizationScore,
  };
}

function averageScores(scores: Record<ProgressDimensionKey, number>): number {
  const values = Object.values(scores);
  if (values.length === 0) return 1;
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(1));
}

function getLowestDimension(scores: Record<ProgressDimensionKey, number>): ProgressDimensionKey {
  let selected: ProgressDimensionKey = 'distribution_readiness';
  let min = Number.POSITIVE_INFINITY;
  for (const [key, value] of Object.entries(scores) as Array<[ProgressDimensionKey, number]>) {
    if (value < min) {
      min = value;
      selected = key;
    }
  }
  return selected;
}

function getDeltaLabel(delta: number): ScorePair['delta_label'] {
  if (delta <= -1) return 'decline';
  if (delta === 0) return 'no_change';
  if (delta <= 1) return 'slight_progress';
  if (delta <= 4) return 'meaningful_progress';
  return 'major_progress';
}

function dimensionLabel(key: ProgressDimensionKey): string {
  return key
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function buildNextAction(lowest: ProgressDimensionKey): string {
  if (lowest === 'distribution_readiness') {
    return 'Connect at least one publishing channel and push 3 approved assets to move from strategy to distribution.';
  }
  if (lowest === 'content_system') {
    return 'Increase structured content output: create 10 new assets, approve at least 3, and standardize formats across channels.';
  }
  if (lowest === 'market_intelligence') {
    return 'Validate more competitors and refresh your keyword + matrix analysis to strengthen market intelligence.';
  }
  if (lowest === 'strategy_readiness') {
    return 'Complete strategy foundations by finalizing pillars, persona clarity, and running at least one full strategy refresh.';
  }
  if (lowest === 'brand_understanding') {
    return 'Tighten brand clarity by refining messaging, tone, audience, and offerings to improve downstream content quality.';
  }
  return 'Set a monthly optimization loop: review wins, detect content gaps, and execute the next focused growth sprint.';
}

export function buildWorkspaceProgressReport(input: {
  workspace: {
    createdAt: Date;
    brandSummary: any;
    audienceInsights: any;
    contentItems: Array<{ status: string; channel: string | null }>;
    competitors: Array<{ userDecision?: string | null }>;
  };
  activityLogs: ActivityLogEntry[];
}): WorkspaceProgressReport | null {
  const now = new Date();
  const workspaceCreatedAt = toDate(input.workspace.createdAt);
  const daysSinceSignup = Math.max(
    1,
    Math.ceil((now.getTime() - workspaceCreatedAt.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const insights = input.workspace.audienceInsights && typeof input.workspace.audienceInsights === 'object'
    ? input.workspace.audienceInsights
    : {};

  const baselineRaw = insights?.progressReport?.baseline as BaselineSnapshot | undefined;
  if (!baselineRaw?.scores) {
    return null;
  }

  const baselineScores: Record<ProgressDimensionKey, number> = {
    brand_understanding: clampScore(Number(baselineRaw.scores.brand_understanding)),
    strategy_readiness: clampScore(Number(baselineRaw.scores.strategy_readiness)),
    market_intelligence: clampScore(Number(baselineRaw.scores.market_intelligence)),
    content_system: clampScore(Number(baselineRaw.scores.content_system)),
    distribution_readiness: clampScore(Number(baselineRaw.scores.distribution_readiness)),
    optimization_maturity: clampScore(Number(baselineRaw.scores.optimization_maturity)),
  };

  const strategyRuns =
    countActions(input.activityLogs, ['COMPETITIVE_MATRICES_GENERATED']) +
    countActions(input.activityLogs, ['BRAND_MEMORY_RESCRAPE_SUCCEEDED']);
  const refinements = countActions(input.activityLogs, [
    'COMPETITIVE_MATRICES_EDITED',
    'COMPETITOR_MANUAL_EDIT_SAVED',
    'PRODUCTS_SERVICES_INTEL_EDITED',
    'COMPETITOR_REVIEW_SAVED',
  ]);

  const generatedCount =
    countByStatus(input.workspace.contentItems, 'GENERATED') +
    countByStatus(input.workspace.contentItems, 'EDITED') +
    countByStatus(input.workspace.contentItems, 'READY') +
    countByStatus(input.workspace.contentItems, 'SCHEDULED') +
    countByStatus(input.workspace.contentItems, 'PUBLISHING') +
    countByStatus(input.workspace.contentItems, 'PUBLISHED') +
    countByStatus(input.workspace.contentItems, 'EXPORTED');
  const approvedCount =
    countActions(input.activityLogs, ['CONTENT_APPROVED']) +
    countByStatus(input.workspace.contentItems, 'READY') +
    countByStatus(input.workspace.contentItems, 'SCHEDULED') +
    countByStatus(input.workspace.contentItems, 'PUBLISHING') +
    countByStatus(input.workspace.contentItems, 'PUBLISHED') +
    countByStatus(input.workspace.contentItems, 'EXPORTED');
  const publishedCount = countActions(input.activityLogs, ['CONTENT_PUBLISHED', 'CONTENT_SCHEDULED']) +
    countByStatus(input.workspace.contentItems, 'PUBLISHED') +
    countByStatus(input.workspace.contentItems, 'SCHEDULED') +
    countByStatus(input.workspace.contentItems, 'EXPORTED');
  const connectedChannels = getDistinctConnectedChannels(input.activityLogs);
  const uniqueChannelsUsed = new Set(
    input.workspace.contentItems.map((item) => item.channel || '').filter(Boolean),
  ).size;
  const acceptedCompetitors = input.workspace.competitors.filter(
    (item) => item.userDecision === 'ACCEPTED',
  ).length;

  const nowScores = buildInitialScores({
    brandSummary: input.workspace.brandSummary || {},
    contentItems: input.workspace.contentItems,
    competitors: input.workspace.competitors,
    insights,
    activityLogs: input.activityLogs,
  });

  const beforeAvg = averageScores(baselineScores);
  const nowAvg = averageScores(nowScores);
  const overallBefore = getOverallScore(baselineScores);
  const overallNow = getOverallScore(nowScores);
  const beforeStage = baselineRaw.maturity_stage || toMaturityStage(beforeAvg);
  const nowStage = toMaturityStage(nowAvg);

  const dimensionScores: Record<ProgressDimensionKey, ScorePair> = {
    brand_understanding: {
      before: baselineScores.brand_understanding,
      now: nowScores.brand_understanding,
      delta: nowScores.brand_understanding - baselineScores.brand_understanding,
      delta_label: getDeltaLabel(nowScores.brand_understanding - baselineScores.brand_understanding),
    },
    strategy_readiness: {
      before: baselineScores.strategy_readiness,
      now: nowScores.strategy_readiness,
      delta: nowScores.strategy_readiness - baselineScores.strategy_readiness,
      delta_label: getDeltaLabel(nowScores.strategy_readiness - baselineScores.strategy_readiness),
    },
    market_intelligence: {
      before: baselineScores.market_intelligence,
      now: nowScores.market_intelligence,
      delta: nowScores.market_intelligence - baselineScores.market_intelligence,
      delta_label: getDeltaLabel(nowScores.market_intelligence - baselineScores.market_intelligence),
    },
    content_system: {
      before: baselineScores.content_system,
      now: nowScores.content_system,
      delta: nowScores.content_system - baselineScores.content_system,
      delta_label: getDeltaLabel(nowScores.content_system - baselineScores.content_system),
    },
    distribution_readiness: {
      before: baselineScores.distribution_readiness,
      now: nowScores.distribution_readiness,
      delta: nowScores.distribution_readiness - baselineScores.distribution_readiness,
      delta_label: getDeltaLabel(nowScores.distribution_readiness - baselineScores.distribution_readiness),
    },
    optimization_maturity: {
      before: baselineScores.optimization_maturity,
      now: nowScores.optimization_maturity,
      delta: nowScores.optimization_maturity - baselineScores.optimization_maturity,
      delta_label: getDeltaLabel(nowScores.optimization_maturity - baselineScores.optimization_maturity),
    },
  };

  const biggestGains = (Object.entries(dimensionScores) as Array<[ProgressDimensionKey, ScorePair]>)
    .map(([key, pair]) => ({
      key,
      delta: pair.delta,
    }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .filter((item) => item.delta > 0)
    .map((item) => `${dimensionLabel(item.key)} (+${item.delta})`);

  const lowestDimension = getLowestDimension(nowScores);
  const nextBestAction = buildNextAction(lowestDimension);

  const milestoneTriggers: string[] = [];
  if (strategyRuns > 0) milestoneTriggers.push('First strategy checkpoint completed');
  if (generatedCount >= 10) milestoneTriggers.push('10+ content assets generated');
  if (connectedChannels >= 1 || uniqueChannelsUsed >= 1) {
    milestoneTriggers.push('At least one channel active in workflow');
  }
  if (approvedCount >= 1) milestoneTriggers.push('First publish-ready asset completed');
  if (acceptedCompetitors >= 3) milestoneTriggers.push('Competitor map validated with 3+ accepted rivals');

  return {
    report_type: 'marketing_evolution',
    report_generated_at: now.toISOString(),
    baseline_created_at: toDate(baselineRaw.created_at).toISOString(),
    time_window_days: daysSinceSignup,
    report_name: 'Marketing Evolution Report',
    point_a_summary: `At signup, this workspace was at ${beforeStage} with limited structure across strategy, market intelligence, and distribution readiness.`,
    point_b_summary: `After ${daysSinceSignup} day(s), the workspace is now at ${nowStage} with stronger systems across brand, strategy, and content execution.`,
    progress_delta:
      biggestGains.length > 0
        ? `Biggest measurable gains: ${biggestGains.join(', ')}.`
        : 'Progress is still early; usage is recorded but major score jumps have not happened yet.',
    dimension_scores: dimensionScores,
    usage_summary: {
      days_since_signup: daysSinceSignup,
      meaningful_sessions: getMeaningfulSessionDays(input.activityLogs),
      strategy_runs: strategyRuns,
      content_generated: generatedCount,
      approved_assets: approvedCount,
      published_assets: publishedCount,
      connected_channels: connectedChannels,
      competitor_validations: acceptedCompetitors,
      refinements,
    },
    maturity: {
      before_stage: beforeStage,
      now_stage: nowStage,
      before_average: beforeAvg,
      now_average: nowAvg,
    },
    overall_score_before: overallBefore,
    overall_score_now: overallNow,
    narrative_summary: `You started with an unstructured marketing setup and moved toward a repeatable system. In ${daysSinceSignup} days, your workspace built clearer brand understanding, stronger strategy readiness, and more operational content flow. The next leverage point is ${dimensionLabel(lowestDimension)}.`,
    next_best_action: nextBestAction,
    milestone_triggers:
      milestoneTriggers.length > 0
        ? milestoneTriggers
        : ['No major milestone hit yet. Focus on first strategy run and 10 generated assets.'],
  };
}

export function createWorkspaceProgressBaseline(input: {
  brandSummary: any;
  audienceInsights?: any;
}): BaselineSnapshot {
  const contentItems: Array<{ status: string; channel: string | null }> = [];
  const competitors: Array<{ userDecision?: string | null }> = [];
  const insights = input.audienceInsights && typeof input.audienceInsights === 'object' ? input.audienceInsights : {};
  const scores = buildInitialScores({
    brandSummary: input.brandSummary || {},
    contentItems,
    competitors,
    insights,
    activityLogs: [],
  });
  const avg = averageScores(scores);
  return {
    created_at: new Date().toISOString(),
    scores,
    maturity_stage: toMaturityStage(avg),
    metrics: {
      content_items: 0,
      discovered_competitors: 0,
      accepted_competitors: 0,
      connected_channels: 0,
      strategy_runs: 0,
    },
  };
}

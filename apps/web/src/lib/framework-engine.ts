export type FrameworkId =
  | 'hook_value_cta'
  | 'problem_cause_solution'
  | 'what_why_how'
  | 'opinion_reason_example'
  | 'aida'
  | 'insight_implication_action';

export type FrameworkCategory = 'social' | 'educational' | 'sales' | 'strategy';
export type FunnelStage = 'AUTO' | 'TOFU' | 'MOFU' | 'BOFU';
export type SelectionMode = 'auto' | 'manual';

export type ContentGoal =
  | 'awareness'
  | 'engagement'
  | 'authority'
  | 'education'
  | 'conversion'
  | 'strategic_education'
  | 'decision_support';

export type ContentPlatform =
  | 'linkedin'
  | 'x'
  | 'blog'
  | 'email'
  | 'landing_page'
  | 'ad'
  | 'strategy_note';

export type FrameworkQualityScores = {
  brand_fit: number;
  audience_fit: number;
  goal_fit: number;
  platform_fit: number;
  clarity_usefulness: number;
  overall_score: number;
};

export type FrameworkSelectionInput = {
  goal?: ContentGoal | string | null;
  platform?: ContentPlatform | string | null;
  funnelStage?: FunnelStage | string | null;
  selectionMode?: SelectionMode | string | null;
  manualFrameworkId?: FrameworkId | string | null;
  audience?: string | null;
};

export type FrameworkSelectionResult = {
  framework_id: FrameworkId;
  framework_name: string;
  framework_category: FrameworkCategory;
  selection_mode: SelectionMode;
  selection_reason: string;
  fallback_hierarchy: FrameworkId[];
};

type FrameworkDefinition = {
  id: FrameworkId;
  name: string;
  category: FrameworkCategory;
  shortDescription: string;
  useWhen: string;
  outputGuide: string;
};

export const FRAMEWORK_LIBRARY: FrameworkDefinition[] = [
  {
    id: 'hook_value_cta',
    name: 'Hook → Value → CTA',
    category: 'social',
    shortDescription: 'Short-form social content with clear hook and actionable close.',
    useWhen: 'Best for LinkedIn/X awareness, engagement, and lightweight authority.',
    outputGuide:
      'Start with a sharp hook, deliver one concrete value insight, and end with a natural CTA.',
  },
  {
    id: 'problem_cause_solution',
    name: 'Problem → Cause → Solution',
    category: 'educational',
    shortDescription: 'Explains a pain, why it happens, and practical fix.',
    useWhen: 'Best for educational blog/email/social posts and pain-clarification content.',
    outputGuide:
      'Define the problem precisely, explain root cause, then provide practical and realistic solution steps.',
  },
  {
    id: 'what_why_how',
    name: 'What → Why → How',
    category: 'educational',
    shortDescription: 'Structured explainers and SEO-aligned educational content.',
    useWhen: 'Best for concept explainers, evergreen educational pieces, and SEO clarity.',
    outputGuide:
      'Define the concept, explain strategic importance, then provide implementation approach.',
  },
  {
    id: 'opinion_reason_example',
    name: 'Strong Opinion → Reason → Example',
    category: 'social',
    shortDescription: 'Positioning and thought-leadership format for bold authority.',
    useWhen: 'Best for authority, differentiation, and contrarian-but-credible social content.',
    outputGuide:
      'Lead with clear opinion, justify with strategic reason, and add a grounded example/scenario.',
  },
  {
    id: 'aida',
    name: 'AIDA',
    category: 'sales',
    shortDescription: 'Conversion-focused persuasion sequence.',
    useWhen: 'Best for BOFU, landing pages, ad copy, and conversion-oriented campaigns.',
    outputGuide:
      'Build attention, sustain interest, create desire with outcomes/proof, then finish with clear action.',
  },
  {
    id: 'insight_implication_action',
    name: 'Insight → Implication → Action',
    category: 'strategy',
    shortDescription: 'Strategic content format that turns analysis into action.',
    useWhen: 'Best for strategy notes, authority posts, and decision-support narratives.',
    outputGuide:
      'Provide one sharp insight, explain business implication, then recommend specific next action.',
  },
];

export const FRAMEWORK_LABELS: Record<FrameworkId, string> = FRAMEWORK_LIBRARY.reduce(
  (acc, item) => {
    acc[item.id] = item.name;
    return acc;
  },
  {} as Record<FrameworkId, string>,
);

export const CONTENT_GOAL_OPTIONS: Array<{ value: ContentGoal; label: string }> = [
  { value: 'awareness', label: 'Awareness' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'authority', label: 'Authority' },
  { value: 'education', label: 'Education' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'strategic_education', label: 'Strategic Education' },
  { value: 'decision_support', label: 'Decision Support' },
];

export const CONTENT_PLATFORM_OPTIONS: Array<{ value: ContentPlatform; label: string }> = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X / Twitter' },
  { value: 'blog', label: 'Blog' },
  { value: 'email', label: 'Email' },
  { value: 'landing_page', label: 'Landing Page' },
  { value: 'ad', label: 'Ad Copy' },
  { value: 'strategy_note', label: 'Strategy Note' },
];

export const FUNNEL_STAGE_OPTIONS: Array<{ value: FunnelStage; label: string }> = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'TOFU', label: 'TOFU' },
  { value: 'MOFU', label: 'MOFU' },
  { value: 'BOFU', label: 'BOFU' },
];

const FALLBACK_MAP: Record<FrameworkId, FrameworkId[]> = {
  hook_value_cta: ['opinion_reason_example', 'problem_cause_solution'],
  opinion_reason_example: ['hook_value_cta', 'problem_cause_solution'],
  problem_cause_solution: ['what_why_how', 'insight_implication_action'],
  what_why_how: ['problem_cause_solution', 'insight_implication_action'],
  aida: ['problem_cause_solution', 'hook_value_cta'],
  insight_implication_action: ['problem_cause_solution', 'what_why_how'],
};

function normalizeGoal(value: unknown): ContentGoal {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'awareness') return 'awareness';
  if (raw === 'engagement') return 'engagement';
  if (raw === 'authority') return 'authority';
  if (raw === 'education') return 'education';
  if (raw === 'conversion') return 'conversion';
  if (raw === 'strategic_education') return 'strategic_education';
  if (raw === 'decision_support') return 'decision_support';
  return 'authority';
}

function normalizePlatform(value: unknown): ContentPlatform {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'linkedin') return 'linkedin';
  if (raw === 'x' || raw === 'twitter') return 'x';
  if (raw === 'blog' || raw === 'article') return 'blog';
  if (raw === 'email' || raw === 'newsletter') return 'email';
  if (raw === 'landing_page' || raw === 'landing') return 'landing_page';
  if (raw === 'ad' || raw === 'ads') return 'ad';
  if (raw === 'strategy_note' || raw === 'memo') return 'strategy_note';
  return 'linkedin';
}

function normalizeFunnel(value: unknown): FunnelStage {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'TOFU' || raw === 'MOFU' || raw === 'BOFU') return raw;
  return 'AUTO';
}

function normalizeMode(value: unknown): SelectionMode {
  return String(value || '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto';
}

function isFrameworkId(value: string): value is FrameworkId {
  return FRAMEWORK_LIBRARY.some((item) => item.id === value);
}

function findFramework(id: FrameworkId): FrameworkDefinition {
  return FRAMEWORK_LIBRARY.find((item) => item.id === id) || FRAMEWORK_LIBRARY[0];
}

function getAutoFramework(
  goal: ContentGoal,
  platform: ContentPlatform,
  funnel: FunnelStage,
): FrameworkId {
  if (platform === 'landing_page' || platform === 'ad' || goal === 'conversion' || funnel === 'BOFU') {
    return 'aida';
  }

  if (platform === 'strategy_note' || goal === 'strategic_education' || goal === 'decision_support') {
    return 'insight_implication_action';
  }

  if (platform === 'blog' || goal === 'education') {
    return goal === 'education' ? 'what_why_how' : 'problem_cause_solution';
  }

  if (goal === 'authority') {
    return 'opinion_reason_example';
  }

  if (goal === 'awareness' || goal === 'engagement') {
    return 'hook_value_cta';
  }

  return 'problem_cause_solution';
}

export function selectFramework(input: FrameworkSelectionInput): FrameworkSelectionResult {
  const mode = normalizeMode(input.selectionMode);
  const goal = normalizeGoal(input.goal);
  const platform = normalizePlatform(input.platform);
  const funnel = normalizeFunnel(input.funnelStage);

  let frameworkId: FrameworkId;
  let reason = '';

  if (mode === 'manual' && isFrameworkId(String(input.manualFrameworkId || '').trim())) {
    frameworkId = String(input.manualFrameworkId) as FrameworkId;
    reason = `Manual selection. Goal=${goal}, Platform=${platform}, Funnel=${funnel}.`;
  } else {
    frameworkId = getAutoFramework(goal, platform, funnel);
    reason = `Auto-selected from goal=${goal}, platform=${platform}, funnel=${funnel}.`;
  }

  const framework = findFramework(frameworkId);
  return {
    framework_id: framework.id,
    framework_name: framework.name,
    framework_category: framework.category,
    selection_mode: mode,
    selection_reason: `${reason} ${framework.useWhen}`,
    fallback_hierarchy: FALLBACK_MAP[framework.id] || [],
  };
}

export function getFrameworkGuidance(frameworkId: FrameworkId): string {
  const framework = findFramework(frameworkId);
  return `${framework.name}: ${framework.shortDescription} ${framework.outputGuide}`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(10, Number(value.toFixed(2))));
}

export function normalizeQualityScores(input: Partial<FrameworkQualityScores> | null | undefined): FrameworkQualityScores {
  const brand = clampScore(Number(input?.brand_fit ?? 7));
  const audience = clampScore(Number(input?.audience_fit ?? 7));
  const goal = clampScore(Number(input?.goal_fit ?? 7));
  const platform = clampScore(Number(input?.platform_fit ?? 7));
  const clarity = clampScore(Number(input?.clarity_usefulness ?? 7));
  const overall = clampScore(
    Number(input?.overall_score ?? (brand + audience + goal + platform + clarity) / 5),
  );

  return {
    brand_fit: brand,
    audience_fit: audience,
    goal_fit: goal,
    platform_fit: platform,
    clarity_usefulness: clarity,
    overall_score: overall,
  };
}

export function shouldUseFallback(scores: FrameworkQualityScores): boolean {
  return scores.overall_score < 6.6;
}

export function getFallbackFramework(primary: FrameworkId): FrameworkId | null {
  const chain = FALLBACK_MAP[primary] || [];
  return chain[0] || null;
}

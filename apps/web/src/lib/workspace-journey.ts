/**
 * workspace-journey.ts
 *
 * Contivo is a dependency chain wearing the clothes of a dashboard: you
 * cannot ideate without keywords, cannot get keywords without competitors,
 * cannot publish without a channel. The UI used to present all of that as a
 * flat menu of eleven tabs, so the only way to learn the order was to hit a
 * wall — which is exactly what happened to the product's own author.
 *
 * This module is the single source of truth for that chain. The tab strip,
 * the guide, and the dashboard all read from it, so they cannot disagree
 * about what the user should do next.
 */

export type StepId = 'brand' | 'market' | 'keywords' | 'narrative' | 'channel' | 'autopilot';

export type StepState = 'done' | 'current' | 'locked' | 'available';

export type JourneyStep = {
  id: StepId;
  /** 1-based position in the setup chain. */
  order: number;
  title: string;
  /** What this step buys the user, in plain language. */
  why: string;
  /** Where to go to do it. */
  href: string;
  /** The literal thing to click once there. */
  action: string;
  state: StepState;
  /** Human sentence describing current progress, e.g. "5 charts". */
  detail: string;
  /** Only set when locked: which step must happen first. */
  blockedBy?: string;
};

export type WorkspaceFacts = {
  workspaceId: string;
  hasBrandSummary: boolean;
  acceptedCompetitors: number;
  totalCompetitors: number;
  matrixCharts: number;
  keywordCompetitors: number;
  /** Storylines on the workspace's narrative. Zero means it has no position yet. */
  storylines: number;
  hasChannel: boolean;
  channelLabel: string | null;
  autopilotEnabled: boolean;
  publishedCount: number;
  scheduledCount: number;
};

export type Journey = {
  steps: JourneyStep[];
  /** The one thing to do next; null when setup is complete. */
  next: JourneyStep | null;
  completed: number;
  total: number;
  /** 0-100 across setup steps only. */
  percent: number;
  isComplete: boolean;
};

export function buildJourney(f: WorkspaceFacts): Journey {
  const tab = (t: string) => `/growth/${f.workspaceId}?tab=${t}`;

  // Each step declares whether it is done and what blocks it. Order matters:
  // the first not-done, not-locked step becomes "current".
  const raw: Array<Omit<JourneyStep, 'state' | 'order'> & { done: boolean; blockedBy?: string }> = [
    {
      id: 'brand',
      title: 'Build Brand Memory',
      why: 'Everything Contivo writes is grounded in this. Without it there is no voice to write in.',
      href: tab('strategy'),
      action: 'Review or rescrape brand memory',
      done: f.hasBrandSummary,
      detail: f.hasBrandSummary ? 'Extracted from your site' : 'Not extracted yet',
    },
    {
      id: 'market',
      title: 'Map the market',
      why: 'Accept the competitors that are really yours, then generate the positioning charts. Ideas are built from the gaps this reveals.',
      href: tab('matrices'),
      action:
        f.acceptedCompetitors < 2
          ? 'Discover and accept at least 2 competitors'
          : 'Generate the positioning matrices',
      done: f.matrixCharts > 0 && f.acceptedCompetitors >= 2,
      detail:
        f.matrixCharts > 0
          ? `${f.matrixCharts} charts · ${f.acceptedCompetitors} competitors accepted`
          : f.totalCompetitors > 0
            ? `${f.acceptedCompetitors} of ${f.totalCompetitors} competitors accepted · no charts yet`
            : 'No competitors discovered yet',
      blockedBy: f.hasBrandSummary ? undefined : 'Brand Memory',
    },
    {
      id: 'keywords',
      title: 'Analyse competitor keywords',
      why: 'Shows which topics competitors own and which they leave open. This is where content gets its angle.',
      href: tab('keywords'),
      action: 'Run keyword analysis',
      done: f.keywordCompetitors > 0,
      detail:
        f.keywordCompetitors > 0
          ? `${f.keywordCompetitors} competitors analysed`
          : 'Not analysed yet',
      // Needs real competitors to analyse — running it with none produces nothing.
      blockedBy: f.acceptedCompetitors >= 1 ? undefined : 'accepted competitors',
    },
    {
      id: 'narrative',
      title: 'Decide what you stand for',
      why: 'Three or four arguments every post has to advance, so the content adds up instead of being forty unrelated posts. Drafted from the intelligence above.',
      href: tab('narrative'),
      action: 'Draft the narrative',
      done: f.storylines > 0,
      detail: f.storylines > 0 ? `${f.storylines} storylines` : 'No position yet',
      // Needs a market frame and something to be positioned against. Keywords
      // sharpen it but are not required, so this is reachable without them.
      blockedBy:
        f.hasBrandSummary && f.matrixCharts > 0 && f.acceptedCompetitors >= 2
          ? undefined
          : 'the market map',
    },
    {
      id: 'channel',
      title: 'Connect somewhere to publish',
      why: 'A social account or your own website. Without one, drafts have nowhere to go.',
      href: '/connections',
      action: 'Connect an account or add a site',
      done: f.hasChannel,
      detail: f.hasChannel ? (f.channelLabel ?? 'Connected') : 'Nothing connected',
    },
    {
      id: 'autopilot',
      title: 'Turn on Autopilot',
      why: 'Contivo then ideates, drafts, quality-checks and publishes on your schedule without being asked.',
      href: tab('autopilot'),
      action: f.autopilotEnabled ? 'Review the policy' : 'Enable and save the policy',
      done: f.autopilotEnabled,
      detail: f.autopilotEnabled ? 'Running' : 'Off',
      blockedBy: f.autopilotEnabled
        ? undefined
        : f.hasBrandSummary && f.matrixCharts > 0 && f.keywordCompetitors > 0
          ? f.storylines > 0
            ? f.hasChannel
              ? undefined
              : 'a connected channel'
            : 'a narrative to advance'
          : 'the intelligence steps above',
    },
  ];

  let currentAssigned = false;
  const steps: JourneyStep[] = raw.map((s, i) => {
    let state: StepState;
    if (s.done) {
      state = 'done';
    } else if (s.blockedBy) {
      state = 'locked';
    } else if (!currentAssigned) {
      state = 'current';
      currentAssigned = true;
    } else {
      state = 'available';
    }
    const rest: Omit<JourneyStep, 'state' | 'order'> = {
      id: s.id,
      title: s.title,
      why: s.why,
      href: s.href,
      action: s.action,
      detail: s.detail,
      blockedBy: s.blockedBy,
    };
    return { ...rest, order: i + 1, state };
  });

  const completed = steps.filter((s) => s.state === 'done').length;
  const next = steps.find((s) => s.state === 'current') ?? null;

  return {
    steps,
    next,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    isComplete: completed === steps.length,
  };
}

/**
 * Which tabs are gated, and why. Used to mark the tab strip so a user never
 * clicks into a screen whose primary button cannot work yet.
 */
export function tabGate(f: WorkspaceFacts): Record<string, string | undefined> {
  return {
    keywords: f.acceptedCompetitors >= 1 ? undefined : 'Accept competitors first',
    ideation:
      f.matrixCharts > 0 && f.keywordCompetitors > 0
        ? undefined
        : 'Needs matrices + keywords',
    offerings: f.acceptedCompetitors >= 1 ? undefined : 'Accept competitors first',
    narrative:
      f.matrixCharts > 0 && f.acceptedCompetitors >= 2 ? undefined : 'Needs the market map',
    // An agent that is already running is not blocked, whatever it is missing —
    // the runner never required a narrative and does not now. Telling someone
    // their working autopilot "will produce nothing useful" is simply false, and
    // that false warning is the whole risk of adding a step to a live chain.
    autopilot: f.autopilotEnabled
      ? undefined
      : f.matrixCharts > 0 && f.keywordCompetitors > 0
        ? f.storylines > 0
          ? undefined
          : 'Needs a narrative'
        : 'Needs matrices + keywords',
    reports:
      f.matrixCharts >= 5 && f.keywordCompetitors > 0 ? undefined : 'Needs full intelligence',
  };
}

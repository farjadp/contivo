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

/**
 * A sentence this module has decided on but cannot write, because it does not
 * know what language the reader is in.
 *
 * This file runs on the server with no request context of its own, and its
 * output is rendered by two different screens. Returning finished English
 * sentences is what left the whole setup chain in English on /fa while every
 * label around it was Persian. It names the message instead, and the component
 * that has a translator resolves it.
 */
export type Msg = {
  /** Key under the `journey` namespace, e.g. 'steps.brand.title'. */
  key: string;
  /** ICU values, when the sentence interpolates counts. */
  values?: Record<string, string | number>;
};

export type JourneyStep = {
  id: StepId;
  /** 1-based position in the setup chain. */
  order: number;
  title: Msg;
  /** What this step buys the user, in plain language. */
  why: Msg;
  /** Where to go to do it. */
  href: string;
  /** The literal thing to click once there. */
  action: Msg;
  state: StepState;
  /** Describes current progress, e.g. "5 charts". */
  detail: Msg;
  /** Only set when locked: which step must happen first. */
  blockedBy?: Msg;
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
  const m = (key: string, values?: Record<string, string | number>): Msg => ({
    key: `steps.${key}`,
    values,
  });
  const blocker = (key: string): Msg => ({ key: `blockers.${key}` });

  // Each step declares whether it is done and what blocks it. Order matters:
  // the first not-done, not-locked step becomes "current".
  const raw: Array<Omit<JourneyStep, 'state' | 'order'> & { done: boolean; blockedBy?: Msg }> = [
    {
      id: 'brand',
      title: m('brand.title'),
      why: m('brand.why'),
      href: tab('strategy'),
      action: m('brand.action'),
      done: f.hasBrandSummary,
      detail: f.hasBrandSummary ? m('brand.detailDone') : m('brand.detailTodo'),
    },
    {
      id: 'market',
      title: m('market.title'),
      why: m('market.why'),
      href: tab('matrices'),
      action:
        f.acceptedCompetitors < 2 ? m('market.actionDiscover') : m('market.actionCharts'),
      done: f.matrixCharts > 0 && f.acceptedCompetitors >= 2,
      detail:
        f.matrixCharts > 0
          ? m('market.detailDone', {
              charts: f.matrixCharts,
              competitors: f.acceptedCompetitors,
            })
          : f.totalCompetitors > 0
            ? m('market.detailPartial', {
                accepted: f.acceptedCompetitors,
                total: f.totalCompetitors,
              })
            : m('market.detailNone'),
      blockedBy: f.hasBrandSummary ? undefined : blocker('brandMemory'),
    },
    {
      id: 'keywords',
      title: m('keywords.title'),
      why: m('keywords.why'),
      href: tab('keywords'),
      action: m('keywords.action'),
      done: f.keywordCompetitors > 0,
      detail:
        f.keywordCompetitors > 0
          ? m('keywords.detailDone', { count: f.keywordCompetitors })
          : m('keywords.detailTodo'),
      // Needs real competitors to analyse — running it with none produces nothing.
      blockedBy: f.acceptedCompetitors >= 1 ? undefined : blocker('acceptedCompetitors'),
    },
    {
      id: 'narrative',
      title: m('narrative.title'),
      why: m('narrative.why'),
      href: tab('narrative'),
      action: m('narrative.action'),
      done: f.storylines > 0,
      detail:
        f.storylines > 0
          ? m('narrative.detailDone', { count: f.storylines })
          : m('narrative.detailTodo'),
      // Needs a market frame and something to be positioned against. Keywords
      // sharpen it but are not required, so this is reachable without them.
      blockedBy:
        f.hasBrandSummary && f.matrixCharts > 0 && f.acceptedCompetitors >= 2
          ? undefined
          : blocker('marketMap'),
    },
    {
      id: 'channel',
      title: m('channel.title'),
      why: m('channel.why'),
      href: '/connections',
      action: m('channel.action'),
      done: f.hasChannel,
      detail: f.hasChannel
        ? f.channelLabel
          ? /* A provider name from the database — shown as-is, not translated. */
            { key: 'steps.channel.detailNamed', values: { name: f.channelLabel } }
          : m('channel.detailDone')
        : m('channel.detailTodo'),
    },
    {
      id: 'autopilot',
      title: m('autopilot.title'),
      why: m('autopilot.why'),
      href: tab('autopilot'),
      action: f.autopilotEnabled ? m('autopilot.actionReview') : m('autopilot.actionEnable'),
      done: f.autopilotEnabled,
      detail: f.autopilotEnabled ? m('autopilot.detailOn') : m('autopilot.detailOff'),
      blockedBy: f.autopilotEnabled
        ? undefined
        : f.hasBrandSummary && f.matrixCharts > 0 && f.keywordCompetitors > 0
          ? f.storylines > 0
            ? f.hasChannel
              ? undefined
              : blocker('connectedChannel')
            : blocker('narrative')
          : blocker('intelligenceSteps'),
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
export function tabGate(f: WorkspaceFacts): Record<string, Msg | undefined> {
  const g = (key: string): Msg => ({ key: `gates.${key}` });
  return {
    keywords: f.acceptedCompetitors >= 1 ? undefined : g('acceptCompetitors'),
    ideation: f.matrixCharts > 0 && f.keywordCompetitors > 0 ? undefined : g('matricesAndKeywords'),
    offerings: f.acceptedCompetitors >= 1 ? undefined : g('acceptCompetitors'),
    narrative: f.matrixCharts > 0 && f.acceptedCompetitors >= 2 ? undefined : g('marketMap'),
    // An agent that is already running is not blocked, whatever it is missing —
    // the runner never required a narrative and does not now. Telling someone
    // their working autopilot "will produce nothing useful" is simply false, and
    // that false warning is the whole risk of adding a step to a live chain.
    autopilot: f.autopilotEnabled
      ? undefined
      : f.matrixCharts > 0 && f.keywordCompetitors > 0
        ? f.storylines > 0
          ? undefined
          : g('narrative')
        : g('matricesAndKeywords'),
    reports:
      f.matrixCharts >= 5 && f.keywordCompetitors > 0 ? undefined : g('fullIntelligence'),
  };
}

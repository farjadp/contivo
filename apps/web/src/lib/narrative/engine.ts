/**
 * narrative/engine.ts — turns intelligence into a position.
 *
 * Contivo already computes almost everything April Dunford's positioning
 * process asks for: true competitive alternatives (discovered competitors),
 * unique attributes (products & services), a market frame of reference (the
 * five matrices) and who-cares-a-lot (the persona). What it has never done is
 * say what the company should therefore *stand for*, so its content is forty
 * disconnected posts rather than one argument that accumulates.
 *
 * A storyline here takes Andy Raskin's five-element shape — the change, the
 * winners and losers, the promised land, the "magic gifts", the evidence —
 * rather than fields invented for this codebase. Donald Miller's SB7 governs
 * the shape of an individual post and deliberately stays one layer down, with
 * `framework-engine.ts`, which owns structure (`hook_value_cta`, `aida`, …)
 * and has no concept of a claim.
 *
 * Two inputs have no data source and must come from a human: the change (which
 * we propose, then let them reject) and the evidence (which we ask for once).
 */

import type { EvidenceKind } from '@prisma/client';

import { requestJsonFromAi } from '@/lib/gemini';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ChangeHypothesis = {
  /** The shift itself, one sentence, in the customer's world — not the vendor's. */
  change: string;
  /** Why this is defensible, tied to something in the intelligence. */
  rationale: string;
  /** Which competitor, matrix or keyword gap suggested it. */
  evidence: string[];
};

export type DraftStoryline = {
  claim: string;
  audience: string;
  winners: string;
  losers: string;
  promisedLand: string;
  gifts: string[];
  sourceRefs: string[];
};

export type EvidenceInput = { kind: EvidenceKind; value: string; detail?: string | null };

export type NarrativeContext = {
  brandSummary: any;
  competitiveMatrices: any;
  competitorKeywordsIntel: any;
  competitors: Array<{ name: string; domain: string | null; description: string | null }>;
};

/** Compact the intelligence so the prompt carries signal rather than raw JSON. */
function summariseIntelligence(ctx: NarrativeContext): string {
  const b = ctx.brandSummary ?? {};
  const charts = Array.isArray(ctx.competitiveMatrices?.charts)
    ? ctx.competitiveMatrices.charts
    : [];
  const kwCompetitors = Array.isArray(ctx.competitorKeywordsIntel?.competitors)
    ? ctx.competitorKeywordsIntel.competitors
    : [];

  const chartLines = charts.slice(0, 5).map((c: any) => {
    const title = c?.title ?? c?.name ?? 'chart';
    const x = c?.xAxisLabel ?? c?.xLabel ?? '?';
    const y = c?.yAxisLabel ?? c?.yLabel ?? '?';
    const points = Array.isArray(c?.points ?? c?.data) ? (c.points ?? c.data) : [];
    const plotted = points
      .slice(0, 8)
      .map((p: any) => `${p?.name ?? p?.label ?? '?'}(${p?.x ?? '?'},${p?.y ?? '?'})`)
      .join(' ');
    return `- ${title} [x=${x}, y=${y}]: ${plotted}`;
  });

  const gapLines = kwCompetitors.slice(0, 6).map((c: any) => {
    const gaps = Array.isArray(c?.gaps) ? c.gaps.slice(0, 6).join(', ') : '';
    const clusters = Array.isArray(c?.clusters)
      ? c.clusters.slice(0, 4).map((k: any) => k?.name ?? k).join(', ')
      : '';
    return `- ${c?.domain ?? c?.name ?? '?'} — clusters: ${clusters || 'n/a'} · gaps: ${gaps || 'n/a'}`;
  });

  return `
BRAND
  Business: ${b.businessSummary ?? 'unknown'}
  Value proposition: ${b.valueProposition ?? 'unknown'}
  Audience: ${b.audience ?? 'unknown'}
  Persona: ${b.persona?.title ?? '—'} — ${b.persona?.description ?? '—'}
  Tone: ${b.tone ?? 'unknown'}
  Pillars: ${Array.isArray(b.pillars) ? b.pillars.join(', ') : 'none'}

COMPETITORS (verified, accepted by the customer)
${ctx.competitors.map((c) => `- ${c.name} (${c.domain ?? '?'}) — ${c.description ?? ''}`).join('\n') || '- none'}

MARKET FRAME — positioning charts, each scoring every company 1-10 on two axes
${chartLines.join('\n') || '- none'}

KEYWORD TERRITORY — what competitors own and what they leave open
${gapLines.join('\n') || '- none'}
`.trim();
}

// ---------------------------------------------------------------------------
// Step 1 — propose the change
// ---------------------------------------------------------------------------

/**
 * Proposes two or three candidate shifts in the customer's world.
 *
 * Asked cold, a founder facing an empty box writes something generic, so we
 * propose. But a wrongly guessed change tilts every storyline built on it, so
 * the caller must make rejecting a proposal as easy as editing one.
 *
 * Returns null when no provider answers — never a silent empty narrative.
 */
export async function proposeChanges(
  ctx: NarrativeContext,
): Promise<{ options: ChangeHypothesis[]; provider: string } | null> {
  const prompt = `
You are a positioning strategist. Below is verified intelligence about a company
and the market it competes in.

${summariseIntelligence(ctx)}

Name 2-3 candidate answers to one question: what is genuinely CHANGING in this
company's customers' world, that creates urgency for them?

Rules:
1. The change is about the CUSTOMER'S world, not about this company or its product.
2. It must be defensible from the intelligence above. Cite what suggested it.
3. No generic technology platitudes. "AI is transforming everything" is a failure.
   A usable change is specific enough that a competitor could disagree with it.
4. Each must be materially different from the others, not three phrasings of one.

Return JSON only:
{"options":[{"change":"one sentence","rationale":"why this is defensible","evidence":["what in the data suggested it"]}]}
`.trim();

  const res = await requestJsonFromAi<{ options: ChangeHypothesis[] }>(
    prompt,
    'You are a precise positioning strategist. Output only valid JSON.',
  );
  if (!res?.data?.options?.length) return null;

  return {
    options: res.data.options
      .filter((o) => o && typeof o.change === 'string' && o.change.trim())
      .slice(0, 3)
      .map((o) => ({
        change: String(o.change).trim(),
        rationale: String(o.rationale ?? '').trim(),
        evidence: Array.isArray(o.evidence) ? o.evidence.map(String).slice(0, 5) : [],
      })),
    provider: res.provider,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — draft the storylines
// ---------------------------------------------------------------------------

/**
 * Drafts 3-4 storylines that all hang off one agreed change.
 *
 * `evidence` is a hard boundary, not a hint: a storyline may only promise what
 * the company can actually back. With no evidence at all the storylines must
 * stay at the level of argument and observation, because `humanize.ts` forbids
 * invented client stories and the quality gate vetoes invented statistics —
 * a storyline that needs a fabricated case study will simply never publish.
 */
export async function draftStorylines(
  ctx: NarrativeContext,
  change: string,
  evidence: EvidenceInput[],
): Promise<{ storylines: DraftStoryline[]; provider: string } | null> {
  const allowed = evidence.filter((e) => e.kind !== 'FORBIDDEN_CLAIM');
  const forbidden = evidence.filter((e) => e.kind === 'FORBIDDEN_CLAIM');

  const evidenceBlock = allowed.length
    ? allowed.map((e) => `- [${e.kind}] ${e.value}${e.detail ? ` (${e.detail})` : ''}`).join('\n')
    : '- NONE. This company cannot cite customers, numbers or case studies yet.';

  const prompt = `
You are a positioning strategist writing a company's narrative.

${summariseIntelligence(ctx)}

THE CHANGE this company has committed to (every storyline hangs off it):
"${change}"

EVIDENCE this company can actually back — the ONLY proof any storyline may lean on:
${evidenceBlock}

NEVER CLAIM:
${forbidden.map((e) => `- ${e.value}`).join('\n') || '- nothing specified'}

Write 3-4 storylines. Each is a recurring argument this company makes for months,
not a post idea.

They must be STRUCTURALLY different, not three phrasings of one idea. Tested on
real data, the failure mode is every storyline collapsing into "teams that adopt
this win, teams that don't lose". Avoid it by giving each a different centre:
- one about the WORK that changes (what a team stops doing day to day)
- one about the COST of the status quo (what the old way is quietly charging them)
- one about a SPECIFIC RIVAL POSITION on the charts above that is now exposed
- one about WHO this newly serves that it did not serve before
Each storyline must name a different audience or a different axis of the market
frame. If two share the same winners-and-losers logic, merge them and write another.

For each:
- claim: the one-line argument, stated as a position someone could disagree with
- audience: who specifically this is aimed at
- winners / losers: who this change rewards and who it leaves behind
- promisedLand: what the reader's world looks like once they act on it
- gifts: 2-4 capabilities framed as the means of getting there, NOT a feature list
- sourceRefs: which competitor, chart position or keyword gap above produced this

Hard rules:
1. Never promise something the EVIDENCE cannot back. With no evidence, argue from
   reasoning and observation — never imply customers, results or case studies.
2. No invented statistics, named studies, or first-person client anecdotes.
3. Every storyline must cite at least one real sourceRef from the data above.

Return JSON only:
{"storylines":[{"claim":"","audience":"","winners":"","losers":"","promisedLand":"","gifts":[""],"sourceRefs":[""]}]}
`.trim();

  const res = await requestJsonFromAi<{ storylines: DraftStoryline[] }>(
    prompt,
    'You are a precise positioning strategist. Output only valid JSON. Never invent evidence.',
  );
  if (!res?.data?.storylines?.length) return null;

  const storylines = res.data.storylines
    .filter((s) => s && typeof s.claim === 'string' && s.claim.trim() && s.promisedLand)
    .slice(0, 4)
    .map((s) => ({
      claim: String(s.claim).trim(),
      audience: String(s.audience ?? '').trim(),
      winners: String(s.winners ?? '').trim(),
      losers: String(s.losers ?? '').trim(),
      promisedLand: String(s.promisedLand).trim(),
      gifts: Array.isArray(s.gifts) ? s.gifts.map(String).slice(0, 4) : [],
      sourceRefs: Array.isArray(s.sourceRefs) ? s.sourceRefs.map(String).slice(0, 5) : [],
    }));

  return storylines.length ? { storylines, provider: res.provider } : null;
}

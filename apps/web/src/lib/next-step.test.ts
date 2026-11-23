import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FirstPostState } from './first-post/types';
import { NEXT_STEP_MESSAGE_KEYS, buildNextStep, type NextStepInput } from './next-step';
import { REQUIRED_MATRIX_CHARTS } from './report-readiness';
import type { WorkspaceFacts } from './workspace-journey';

const WS = 'w1';

/** A workspace whose setup is complete except what each case overrides. */
const facts = (overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  workspaceId: WS,
  hasBrandSummary: true,
  acceptedCompetitors: 3,
  totalCompetitors: 3,
  matrixCharts: REQUIRED_MATRIX_CHARTS + 1,
  matricesReady: true,
  keywordCompetitors: 3,
  storylines: 2,
  hasChannel: true,
  channelLabel: 'LINKEDIN',
  autopilotEnabled: false,
  publishedCount: 0,
  scheduledCount: 0,
  ...overrides,
});

const guided = (firstPost: FirstPostState | null, extra: Partial<NextStepInput> = {}): NextStepInput => ({
  guided: true,
  facts: facts({ storylines: 0, hasChannel: false, channelLabel: null }),
  firstPost,
  surface: 'workspace',
  onFirstPostTab: false,
  ...extra,
});

const open = (f: WorkspaceFacts, extra: Partial<NextStepInput> = {}): NextStepInput => ({
  guided: false,
  facts: f,
  firstPost: null,
  surface: 'workspace',
  onFirstPostTab: false,
  ...extra,
});

const draft = (connected: boolean): FirstPostState => ({
  phase: 'draft',
  contentItemId: 'ci1',
  approved: true,
  linkedIn: connected ? { connected: true, accountName: 'Farjad' } : { connected: false },
});

const firstPostTab = `/growth/${WS}?tab=first-post`;

describe('buildNextStep, guided mode (spec §5)', () => {
  it('addCompany: no workspace yet', () => {
    expect(buildNextStep(guided(null, { facts: null, surface: 'today' }))).toEqual({
      id: 'addCompany',
      line: { key: 'nextStep.addCompany.line' },
      action: { kind: 'link', label: { key: 'nextStep.addCompany.action' }, href: '/growth/new' },
      busy: false,
    });
  });

  it('confirmCompetitors: phase confirm', () => {
    expect(buildNextStep(guided({ phase: 'confirm', accepted: 0, suggestions: 6 }))).toEqual({
      id: 'confirmCompetitors',
      counter: { n: 1, total: 4 },
      line: { key: 'nextStep.confirmCompetitors.line' },
      why: { key: 'nextStep.confirmCompetitors.why' },
      action: { kind: 'link', label: { key: 'nextStep.confirmCompetitors.action' }, href: firstPostTab },
      busy: false,
    });
  });

  it('confirmCompetitors also when the state has not been loaded', () => {
    expect(buildNextStep(guided(null))?.id).toBe('confirmCompetitors');
  });

  it('writing: phase running, no button', () => {
    const step = buildNextStep(
      guided({ phase: 'running', runId: 'r', done: [], current: 'keywords', startedAt: '2026-11-23T10:00:00Z' }),
    );
    expect(step).toEqual({
      id: 'writing',
      counter: { n: 2, total: 4 },
      line: { key: 'nextStep.writing.line' },
      busy: true,
    });
  });

  it('runFailed: names the failed step and offers Try again', () => {
    const step = buildNextStep(
      guided({
        phase: 'failed',
        runId: 'r',
        done: [],
        failed: 'keywords',
        errorKind: 'notEnoughCompetitorSignals',
        retriesLeft: 1,
      }),
    );
    expect(step).toEqual({
      id: 'runFailed',
      counter: { n: 2, total: 4 },
      line: { key: 'nextStep.runFailed.line.keywords' },
      action: { kind: 'link', label: { key: 'nextStep.runFailed.action' }, href: firstPostTab },
      busy: false,
    });
  });

  it('runFailed: a second failure offers Write my own instead', () => {
    const step = buildNextStep(
      guided({ phase: 'failed', runId: 'r', done: [], failed: 'draft', errorKind: 'generic', retriesLeft: 0 }),
    );
    expect(step?.line.key).toBe('nextStep.runFailed.line.draft');
    expect(step?.action).toEqual({
      kind: 'link',
      label: { key: 'nextStep.runFailed.actionWriteOwn' },
      href: `/growth/${WS}?tab=pipeline&write=1`,
    });
  });

  it('readDraft: phase draft, not on the first-post tab', () => {
    for (const surface of ['workspace', 'today', 'connections'] as const) {
      expect(buildNextStep(guided(draft(false), { surface }))).toEqual({
        id: 'readDraft',
        counter: { n: 3, total: 4 },
        line: { key: 'nextStep.readDraft.line' },
        action: { kind: 'link', label: { key: 'nextStep.readDraft.action' }, href: firstPostTab },
        busy: false,
      });
    }
  });

  it('connectLinkedIn: phase draft on the first-post tab, LinkedIn not connected', () => {
    expect(buildNextStep(guided(draft(false), { onFirstPostTab: true }))).toEqual({
      id: 'connectLinkedIn',
      counter: { n: 3, total: 4 },
      line: { key: 'nextStep.connectLinkedIn.line' },
      why: { key: 'nextStep.connectLinkedIn.why' },
      action: { kind: 'connectLinkedIn', label: { key: 'nextStep.connectLinkedIn.action' }, workspaceId: WS },
      busy: false,
    });
  });

  it('the first-post tab flag only counts on the workspace page', () => {
    expect(buildNextStep(guided(draft(false), { onFirstPostTab: true, surface: 'today' }))?.id).toBe('readDraft');
  });

  it('publishNow: phase draft, LinkedIn connected, on any surface', () => {
    for (const extra of [{ onFirstPostTab: true }, { surface: 'connected' as const }, { surface: 'today' as const }]) {
      expect(buildNextStep(guided(draft(true), extra))).toEqual({
        id: 'publishNow',
        counter: { n: 4, total: 4 },
        line: { key: 'nextStep.publishNow.line' },
        action: {
          kind: 'publishNow',
          label: { key: 'nextStep.publishNow.action' },
          contentItemId: 'ci1',
          href: firstPostTab,
        },
        busy: false,
      });
    }
  });

  it('publishing: no button', () => {
    expect(buildNextStep(guided({ phase: 'publishing', contentItemId: 'ci1' }))).toEqual({
      id: 'publishing',
      counter: { n: 4, total: 4 },
      line: { key: 'nextStep.publishing.line' },
      busy: true,
    });
  });

  it('firstPostLive: phase published on the first-post tab, even though guided mode just ended', () => {
    const published: FirstPostState = {
      phase: 'published',
      contentItemId: 'ci1',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      publishedAtUtc: '2026-11-23T10:06:00.000Z',
    };
    const expected = {
      id: 'firstPostLive',
      line: { key: 'nextStep.firstPostLive.line' },
      action: {
        kind: 'link',
        label: { key: 'nextStep.firstPostLive.action' },
        href: 'https://www.linkedin.com/feed/update/urn:li:share:1',
        external: true,
      },
      busy: false,
    };
    expect(buildNextStep(guided(published, { onFirstPostTab: true }))).toEqual(expected);
    expect(buildNextStep(open(facts({ publishedCount: 1 }), { firstPost: published, onFirstPostTab: true }))).toEqual(
      expected,
    );
  });

  it('firstPostLive without a safe URL has no button', () => {
    const step = buildNextStep(
      guided({ phase: 'published', contentItemId: 'ci1', url: null, publishedAtUtc: null }, { onFirstPostTab: true }),
    );
    expect(step).toEqual({ id: 'firstPostLive', line: { key: 'nextStep.firstPostLive.line' }, busy: false });
  });
});

describe('buildNextStep, open mode (spec §5 last row, CPO Q2)', () => {
  it('autopilot: when the autopilot tab is not gated and autopilot is off', () => {
    expect(buildNextStep(open(facts({ publishedCount: 1 })))).toEqual({
      id: 'autopilot',
      line: { key: 'nextStep.autopilot.line' },
      action: { kind: 'link', label: { key: 'nextStep.autopilot.action' }, href: `/growth/${WS}?tab=autopilot` },
      busy: false,
    });
  });

  it('narrative: when the autopilot tab is gated on the narrative', () => {
    expect(buildNextStep(open(facts({ publishedCount: 1, storylines: 0 })))).toEqual({
      id: 'narrative',
      line: { key: 'nextStep.narrative.line' },
      why: { key: 'nextStep.narrative.why' },
      action: { kind: 'link', label: { key: 'nextStep.narrative.action' }, href: `/growth/${WS}?tab=narrative` },
      busy: false,
    });
  });

  it('narrative: also when autopilot already runs without a narrative', () => {
    expect(buildNextStep(open(facts({ publishedCount: 1, storylines: 0, autopilotEnabled: true })))?.id).toBe(
      'narrative',
    );
  });

  it('journey: the next setup step when the narrative tab is gated too', () => {
    // A user who published their own post with no market map yet.
    const step = buildNextStep(
      open(
        facts({
          publishedCount: 1,
          storylines: 0,
          matrixCharts: 0,
          matricesReady: false,
          keywordCompetitors: 0,
        }),
      ),
    );
    expect(step).toEqual({
      id: 'journey',
      line: { key: 'journey.steps.market.title' },
      why: { key: 'journey.steps.market.why' },
      action: {
        kind: 'link',
        label: { key: 'journey.steps.market.actionCharts' },
        href: `/growth/${WS}?tab=matrices`,
      },
      busy: false,
    });
  });

  it('journey: whatever setup step is left once autopilot and narrative are covered', () => {
    const step = buildNextStep(open(facts({ publishedCount: 1, autopilotEnabled: true, hasChannel: false })));
    expect(step).toMatchObject({
      id: 'journey',
      line: { key: 'journey.steps.channel.title' },
      action: { kind: 'link', href: '/connections' },
    });
  });

  it('no bar when setup is complete', () => {
    expect(buildNextStep(open(facts({ publishedCount: 1, autopilotEnabled: true })))).toBeNull();
  });

  it('no bar without a workspace', () => {
    expect(buildNextStep(open(facts(), { facts: null }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The catalogue T5 writes                                             */
/* ------------------------------------------------------------------ */

const ALL_INPUTS: NextStepInput[] = [
  guided(null, { facts: null }),
  guided({ phase: 'confirm', accepted: 0, suggestions: 3 }),
  guided({ phase: 'running', runId: 'r', done: [], current: 'idea', startedAt: '2026-11-23T10:00:00Z' }),
  ...(['matrices', 'keywords', 'idea', 'draft'] as const).flatMap((failed) =>
    ([0, 1] as const).map((retriesLeft) =>
      guided({ phase: 'failed', runId: 'r', done: [], failed, errorKind: 'generic', retriesLeft }),
    ),
  ),
  guided(draft(false)),
  guided(draft(false), { onFirstPostTab: true }),
  guided(draft(true)),
  guided({ phase: 'publishing', contentItemId: 'ci1' }),
  guided({ phase: 'published', contentItemId: 'ci1', url: 'https://x.test/p', publishedAtUtc: null }, { onFirstPostTab: true }),
  open(facts({ publishedCount: 1 })),
  open(facts({ publishedCount: 1, storylines: 0 })),
];

const nextStepKeys = (input: NextStepInput): string[] => {
  const step = buildNextStep(input);
  if (!step) return [];
  return [step.line.key, step.why?.key, step.action?.label.key].filter(
    (k): k is string => typeof k === 'string' && k.startsWith('nextStep.'),
  );
};

describe('NEXT_STEP_MESSAGE_KEYS', () => {
  it('lists every nextStep key buildNextStep can emit, and nothing it cannot (except the counter)', () => {
    const emitted = new Set(ALL_INPUTS.flatMap(nextStepKeys));
    expect([...emitted].sort()).toEqual(NEXT_STEP_MESSAGE_KEYS.filter((k) => k !== 'nextStep.counter').sort());
  });

  it('has no duplicates', () => {
    expect(new Set(NEXT_STEP_MESSAGE_KEYS).size).toBe(NEXT_STEP_MESSAGE_KEYS.length);
  });
});

/** Reads a dotted key from the en workspace catalogue (its top-level keys are namespaces). */
const enWorkspace = JSON.parse(
  readFileSync(join(__dirname, '../../messages/en/workspace.json'), 'utf8'),
) as Record<string, unknown>;
const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), enWorkspace);
const words = (text: string) => text.replace(/\{[^}]*\}/g, 'N').split(/\s+/).filter(Boolean).length;

describe.skipIf(!('nextStep' in enWorkspace))('the en nextStep catalogue (written by T5)', () => {
  it('has a string for every key', () => {
    for (const key of NEXT_STEP_MESSAGE_KEYS) expect(typeof lookup(key), key).toBe('string');
  });

  it('keeps every bar at 20 words or fewer, line plus button', () => {
    for (const input of ALL_INPUTS) {
      const step = buildNextStep(input);
      if (!step) continue;
      const text = [step.line, step.action?.label].map((m) => (m ? String(lookup(m.key) ?? '') : '')).join(' ');
      expect(words(text), `${step.id}: ${text}`).toBeLessThanOrEqual(20);
    }
  });
});

/**
 * FREE (reads the LOCAL database only). Builds data/briefs.json for the blind
 * test from real workspaces: brand memory, stored topic, channel, framework
 * choice, storyline, word-count limits — the inputs generateDraftForItem uses.
 *
 *   cd apps/web
 *   set -a; source <primary checkout>/apps/web/.env.local; set +a
 *   BLIND_EXPORT=1 pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts export.run
 *
 * Refuses any DATABASE_URL whose host is not localhost: production rows never
 * go into this file without Farjad's explicit approval.
 */

import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import { getContentWordCountLimits } from '@/lib/app-settings';
import { asContentLanguage, type ContentLanguage } from '@/lib/content-language';
import { clampWordCount, midpointWordCount, resolveWordCountPlatformKey } from '@/lib/content-word-count';
import { prisma } from '@/lib/db';
import { loadStorylineContext, storylinePromptBlock } from '@/lib/narrative/context';

import { BRIEF_SELECTION, BRIEFS_FILE, DATA_DIR, type BriefSelection } from './config';
import type { Brief } from './types';

export function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to read briefs from a non-local database host (${host}).`);
  }
}

const NO_CONTEXT =
  'none. The idea\'s original angle was not stored; generateDraftForItem would pass the item\'s stored text, which is an earlier AI draft and would bias the test.';

async function loggedTargetWordCount(itemId: string): Promise<number | null> {
  const rows = await prisma.activity_logs.findMany({
    where: { action: 'CONTENT_PIPELINE_ITEM_SAVED' },
    select: { detail: true },
  });
  for (const row of rows) {
    const d = row.detail as Record<string, unknown> | null;
    if (d?.itemId === itemId && Number.isFinite(Number(d.targetWordCount)) && Number(d.targetWordCount) > 0) {
      return Number(d.targetWordCount);
    }
  }
  return null;
}

async function buildBrief(sel: BriefSelection, id: string, language: ContentLanguage): Promise<Brief> {
  const limits = await getContentWordCountLimits();
  if (sel.kind === 'content_item') {
    const item = await prisma.contentItem.findUnique({ where: { id: sel.id }, include: { workspace: true } });
    if (!item?.workspace?.brandSummary) throw new Error(`${sel.id}: item or brand summary missing`);
    if (asContentLanguage(item.workspace.contentLanguage) !== language) {
      throw new Error(`${sel.id}: workspace language ${item.workspace.contentLanguage} is not ${language}`);
    }
    const fw = await prisma.content_framework_metadata.findFirst({
      where: { content_item_id: item.id },
      orderBy: { created_at: 'desc' },
    });
    const platform = resolveWordCountPlatformKey(item.channel);
    const range = limits[platform];
    const storyline = await loadStorylineContext(item.storylineId);
    return {
      id,
      language,
      source: { kind: 'content_item', id: item.id, workspaceId: item.workspace.id, note: sel.note },
      workspaceName: item.workspace.name,
      brandSummary: item.workspace.brandSummary,
      topic: item.topic,
      context: '',
      contextNote: NO_CONTEXT,
      channel: item.channel,
      frameworkId: fw?.framework_id ?? null,
      selectionReason: fw?.selection_reason ?? null,
      wordCount: {
        platform,
        min: range.min,
        max: range.max,
        target: clampWordCount(await loggedTargetWordCount(item.id), range, midpointWordCount(range)),
      },
      storylineBlock: storyline ? storylinePromptBlock(storyline) : null,
      storylineClaim: storyline?.claim ?? null,
    };
  }
  const row = await prisma.storyline.findUnique({
    where: { id: sel.id },
    include: { narrative: { include: { workspace: true } } },
  });
  const workspace = row?.narrative.workspace;
  if (!row || !workspace?.brandSummary) throw new Error(`${sel.id}: storyline or brand summary missing`);
  const storyline = await loadStorylineContext(row.id);
  if (!storyline) throw new Error(`${sel.id}: storyline disabled`);
  const platform = resolveWordCountPlatformKey(sel.channel);
  const range = limits[platform];
  return {
    id,
    language,
    source: { kind: 'storyline', id: row.id, workspaceId: workspace.id, note: sel.note },
    workspaceName: workspace.name,
    brandSummary: workspace.brandSummary,
    topic: storyline.claim,
    context: '',
    contextNote: 'none (no stored idea; the storyline block below is the brief).',
    channel: sel.channel,
    frameworkId: null,
    selectionReason: null,
    wordCount: { platform, min: range.min, max: range.max, target: midpointWordCount(range) },
    storylineBlock: storylinePromptBlock(storyline),
    storylineClaim: storyline.claim,
  };
}

describe.skipIf(!process.env.BLIND_EXPORT)('blind test: export briefs (local DB, free)', () => {
  test('writes data/briefs.json', async () => {
    assertLocalDatabase(process.env.DATABASE_URL);
    const briefs: Brief[] = [];
    for (const language of ['EN', 'FA'] as const) {
      for (const [i, sel] of BRIEF_SELECTION[language].entries()) {
        briefs.push(await buildBrief(sel, `${language.toLowerCase()}-${i + 1}`, language));
      }
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BRIEFS_FILE, JSON.stringify({ builtAt: new Date().toISOString(), briefs }, null, 2));
    console.log(`[blind] ${briefs.length} briefs → ${BRIEFS_FILE}`);
    for (const b of briefs) console.log(`  ${b.id} ${b.channel} ${b.wordCount.target}w ${b.workspaceName}: ${b.topic.slice(0, 70)}`);
    expect(briefs.length).toBeGreaterThan(0);
    await prisma.$disconnect();
  });
});

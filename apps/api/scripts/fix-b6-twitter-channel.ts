/**
 * fix-b6-twitter-channel.ts
 *
 * One-off for defect B6 (e2e handover 2026-11-22). Until the fix, the web app
 * guessed an idea's channel from the model's free-text format, and the first
 * rule was `format.includes('x')`: "LinkedIn text post with an example" was
 * saved as `twitter`. X does not publish, so those items are stuck.
 *
 * This finds `twitter` content items and sorts them by the format they were
 * saved with (content_framework_metadata, event IDEA_SAVED_TO_PIPELINE):
 *   - x_intended     the format names X as a whole word (x, twitter, tweet): left alone
 *   - misrouted      the format does not: moved to the channel the format names
 *                    as a whole word (blog, email, instagram), else linkedin
 *   - no_record      no save record (saved without a framework): left alone, counted
 *   - published      PUBLISHED/PUBLISHING: never touched
 *
 * Run from apps/api, with DATABASE_URL in the env:
 *
 *   cd apps/api
 *   pnpm exec ts-node scripts/fix-b6-twitter-channel.ts            # dry run (default)
 *   pnpm exec ts-node scripts/fix-b6-twitter-channel.ts --apply    # writes
 *
 * Against Railway, prefix with: railway run --service contivo-api
 *
 * Safety: prints the datasource host and counts only, never ids, topics or
 * content. Idempotent: an update only touches rows still on `twitter`.
 */

import { Prisma, PrismaClient } from '@prisma/client';

export type TargetChannel = 'linkedin' | 'blog' | 'email' | 'instagram';
export type Classification =
  | { kind: 'x_intended' }
  | { kind: 'no_record' }
  | { kind: 'published' }
  | { kind: 'misrouted'; target: TargetChannel };

const X_WORDS = new Set(['x', 'twitter', 'tweet', 'tweets']);
const OTHER_RULES: ReadonlyArray<readonly [ReadonlySet<string>, TargetChannel]> = [
  [new Set(['blog', 'article', 'articles']), 'blog'],
  [new Set(['email', 'newsletter']), 'email'],
  [new Set(['instagram', 'insta', 'ig']), 'instagram'],
];

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Same whole-word rules as resolveChannelFromFormat in apps/web/src/lib/content-engine.ts. */
export function classify(row: { status: string; savedFormat: string | null; hasSaveRecord: boolean }): Classification {
  if (row.status === 'PUBLISHED' || row.status === 'PUBLISHING') return { kind: 'published' };
  if (!row.hasSaveRecord) return { kind: 'no_record' };
  const w = words(row.savedFormat ?? '');
  if (w.some((word) => X_WORDS.has(word))) return { kind: 'x_intended' };
  for (const [keywords, target] of OTHER_RULES) {
    if (w.some((word) => keywords.has(word))) return { kind: 'misrouted', target };
  }
  return { kind: 'misrouted', target: 'linkedin' };
}

export function parseArgs(args: string[]): { apply: boolean } {
  let apply = false;
  for (const a of args) {
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') apply = false;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { apply };
}

/** Host, port, database and schema only: never credentials. */
function describeDatasource(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''} db=${u.pathname.replace(/^\//, '') || '?'} schema=${u.searchParams.get('schema') ?? 'public'}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function loadSavedFormats(prisma: PrismaClient, ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  try {
    const rows = await prisma.$queryRaw<Array<{ content_item_id: string; fmt: string | null }>>`
      SELECT DISTINCT ON (content_item_id) content_item_id, metadata->>'format' AS fmt
      FROM content_framework_metadata
      WHERE event_name = 'IDEA_SAVED_TO_PIPELINE' AND content_item_id IN (${Prisma.join(ids)})
      ORDER BY content_item_id, created_at DESC`;
    for (const r of rows) map.set(r.content_item_id, r.fmt);
  } catch {
    // The table is created lazily by the web app; no table = no records.
    console.log('note: content_framework_metadata not readable; every item counts as no_record');
  }
  return map;
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  console.log(`datasource: ${describeDatasource(process.env.DATABASE_URL)}`);
  console.log(`mode: ${apply ? 'apply' : 'dry-run'}`);

  const prisma = new PrismaClient();
  try {
    const items = await prisma.contentItem.findMany({
      where: { channel: 'twitter' },
      select: { id: true, status: true, workspaceId: true, agentId: true },
    });
    const formats = await loadSavedFormats(prisma, items.map((i) => i.id));

    const counts: Record<string, number> = {};
    const byTarget = new Map<TargetChannel, string[]>();
    const workspaces = new Set<string>();
    for (const item of items) {
      const c = classify({ status: item.status, savedFormat: formats.get(item.id) ?? null, hasSaveRecord: formats.has(item.id) });
      const key = c.kind === 'misrouted' ? `misrouted→${c.target}` : c.kind;
      counts[key] = (counts[key] ?? 0) + 1;
      counts[`status:${item.status}`] = (counts[`status:${item.status}`] ?? 0) + 1;
      if (item.agentId) counts.autopilot = (counts.autopilot ?? 0) + 1;
      if (c.kind === 'misrouted') {
        byTarget.set(c.target, [...(byTarget.get(c.target) ?? []), item.id]);
        if (item.workspaceId) workspaces.add(item.workspaceId);
      }
    }

    console.log(`twitterItems: ${items.length}`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`${k}: ${v}`);
    console.log(`workspacesWithMisrouted: ${workspaces.size}`);

    if (!apply) {
      console.log('dry run: nothing written. Re-run with --apply to move the misrouted items.');
      return;
    }
    let updated = 0;
    for (const [target, ids] of byTarget) {
      const r = await prisma.contentItem.updateMany({
        where: { id: { in: ids }, channel: 'twitter', status: { notIn: ['PUBLISHED', 'PUBLISHING'] } },
        data: { channel: target },
      });
      console.log(`updated→${target}: ${r.count}`);
      updated += r.count;
    }
    console.log(`updated: ${updated}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Failed');
    process.exit(1);
  });
}

/**
 * backfill-anthropic-cost.ts
 *
 * Fills ai_usage_logs.estimatedCostUsd for Claude rows logged before Claude
 * prices existed (22 Nov 2026: every anthropic row had cost null). Uses the
 * stored token counts.
 *
 * Run from apps/api, with DATABASE_URL in the env:
 *
 *   cd apps/api
 *   pnpm exec ts-node scripts/backfill-anthropic-cost.ts          # dry run
 *   pnpm exec ts-node scripts/backfill-anthropic-cost.ts --apply  # writes
 *
 * Against Railway, prefix with: railway run --service contivo-api
 *
 * Safety:
 *   - Prints the datasource host first, so you can see which database you hit.
 *   - Only touches rows where provider = 'anthropic' AND estimatedCostUsd IS NULL
 *     AND the model is priced below. Idempotent: a second run finds nothing.
 *   - Prints counts and totals only, never ids or user data.
 *
 * Known under-estimate: ai_usage_logs has no web-search column, so Claude web
 * search fees ($0.01 per search) are not in the backfilled cost. Rows logged
 * after the price fix include them.
 *
 * Prices must match PRICES in apps/web/src/lib/ai-usage.ts (USD per 1M tokens).
 */

import { PrismaClient } from '@prisma/client';

export const CLAUDE_PRICES: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 },
  'claude-opus-5-5': { inputPerM: 4, outputPerM: 20 },
};

export function claudeCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = CLAUDE_PRICES[model];
  if (!price) return null;
  return (promptTokens * price.inputPerM + completionTokens * price.outputPerM) / 1_000_000;
}

function datasourceHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').host || '(unset)';
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`datasource: ${datasourceHost()}  mode: ${apply ? 'APPLY' : 'dry run'}`);

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.aiUsageLog.findMany({
      where: { provider: 'anthropic', estimatedCostUsd: null },
      select: { id: true, model: true, promptTokens: true, completionTokens: true },
    });

    const byModel = new Map<string, { rows: number; usd: number }>();
    const updates: Array<{ id: string; usd: number }> = [];
    let unpriced = 0;
    for (const row of rows) {
      const usd = claudeCostUsd(row.model, row.promptTokens, row.completionTokens);
      if (usd === null) {
        unpriced += 1;
        continue;
      }
      updates.push({ id: row.id, usd });
      const entry = byModel.get(row.model) ?? { rows: 0, usd: 0 };
      entry.rows += 1;
      entry.usd += usd;
      byModel.set(row.model, entry);
    }

    console.log(`anthropic rows with null cost: ${rows.length}; priceable: ${updates.length}; unpriced model: ${unpriced}`);
    for (const [model, entry] of byModel) {
      console.log(`  ${model}: ${entry.rows} rows, $${entry.usd.toFixed(6)}`);
    }

    if (!apply) {
      console.log('dry run: nothing written. Re-run with --apply to write.');
      return;
    }

    for (const update of updates) {
      await prisma.aiUsageLog.updateMany({
        where: { id: update.id, estimatedCostUsd: null },
        data: { estimatedCostUsd: update.usd.toFixed(6) },
      });
    }
    console.log(`updated ${updates.length} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

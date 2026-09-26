import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Backfills Workspace.targetCountry / targetLanguage from contentLanguage,
 * per spec §4: contentLanguage = FA -> IR / fa; otherwise -> null / en.
 *
 * Idempotent by construction: both branches are scoped to
 * `targetCountry: null`. The FA branch always writes a non-null country
 * ('IR'), so those rows drop out of the filter and can never be re-touched
 * by a second run. The "otherwise" branch writes targetCountry back to null,
 * so a plain rerun with no user edits in between is a no-op in effect (same
 * values written again) but still safe. Once a user picks a country in the
 * discovery panel or workspace settings, that row's targetCountry is
 * non-null and this script will never select or touch it again, on any
 * future run.
 *
 * Reads only `contentLanguage` and `targetCountry` (the idempotency guard);
 * writes only `targetCountry` and `targetLanguage`.
 */
async function main() {
  const faResult = await prisma.workspace.updateMany({
    where: { targetCountry: null, contentLanguage: 'FA' },
    data: { targetCountry: 'IR', targetLanguage: 'fa' },
  });
  console.log(`Backfilled FA -> IR/fa: ${faResult.count} workspace(s)`);

  const otherResult = await prisma.workspace.updateMany({
    where: { targetCountry: null, NOT: { contentLanguage: 'FA' } },
    data: { targetCountry: null, targetLanguage: 'en' },
  });
  console.log(`Backfilled other -> null/en: ${otherResult.count} workspace(s)`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

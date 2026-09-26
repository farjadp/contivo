import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Backfills Workspace.targetCountry / targetLanguage from contentLanguage,
 * per spec §4: contentLanguage = FA -> IR / fa; otherwise -> null / en.
 *
 * Only promotes FA workspaces to IR/fa, and only where targetCountry is
 * still null (so a rerun never touches a row a user has since given its own
 * market, and never re-fires on a row this script already promoted, since
 * targetCountry is then 'IR', not null).
 *
 * There is no "otherwise" write: targetCountry is nullable and
 * targetLanguage defaults to 'en', so every non-FA row already holds
 * null/en the moment the columns are created — there is nothing for this
 * script to backfill there. Writing null/en to those rows unconditionally
 * would not be a backfill, it would silently overwrite a targetLanguage a
 * user later chose (e.g. non-English content with no fixed target
 * country), on every rerun.
 *
 * Reads only `contentLanguage` and `targetCountry` (the idempotency guard);
 * writes only `targetCountry` and `targetLanguage`, and only on FA rows.
 */
async function main() {
  const faResult = await prisma.workspace.updateMany({
    where: { targetCountry: null, contentLanguage: 'FA' },
    data: { targetCountry: 'IR', targetLanguage: 'fa' },
  });
  console.log(`Promoted FA workspaces to IR/fa: ${faResult.count} workspace(s)`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

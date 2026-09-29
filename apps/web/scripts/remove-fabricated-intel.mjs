// Removes Keywords and Offerings results that the fallbacks deleted on
// 2026-09-29 invented (spec 2026-09-29-no-fabricated-fallbacks, D4).
//
// Dry run by default: prints what it would remove and changes nothing.
//   railway run --service contivo-web node scripts/remove-fabricated-intel.mjs
// Only with --apply does it write, and then only the flagged keys of
// audienceInsights; every other result on the workspace is kept.
//   railway run --service contivo-web node scripts/remove-fabricated-intel.mjs --apply

import { PrismaClient } from '@prisma/client';

import { planCleanup, withoutKeys } from '../src/lib/intel/fabricated.mjs';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, audienceInsights: true },
  });

  const flagged = workspaces
    .map((workspace) => ({ workspace, keys: planCleanup(workspace.audienceInsights) }))
    .filter((item) => item.keys.length > 0);

  console.log(`Scanned ${workspaces.length} workspace(s); ${flagged.length} hold a fabricated result.`);
  for (const { workspace, keys } of flagged) {
    console.log(`  ${workspace.id}  ${JSON.stringify(workspace.name)}  ->  ${keys.join(', ')}`);
  }

  if (!apply) {
    console.log('Dry run: nothing changed. Re-run with --apply to remove these results.');
    return;
  }

  for (const { workspace, keys } of flagged) {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { audienceInsights: withoutKeys(workspace.audienceInsights, keys) },
    });
  }
  console.log(`Removed fabricated results from ${flagged.length} workspace(s).`);
}

main()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

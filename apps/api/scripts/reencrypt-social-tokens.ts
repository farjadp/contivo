/**
 * reencrypt-social-tokens.ts
 *
 * Rewrites social_connections tokens stored in the legacy XOR format into the
 * v1 AES-256-GCM format (see src/modules/social/token-crypto.ts).
 *
 * Run from apps/api, with DATABASE_URL and SOCIAL_TOKEN_SECRET in the env
 * (SOCIAL_TOKEN_SECRET must be the value the existing tokens were written with):
 *
 *   cd apps/api
 *   pnpm exec ts-node scripts/reencrypt-social-tokens.ts            # dry run (default): counts only
 *   pnpm exec ts-node scripts/reencrypt-social-tokens.ts --apply    # rewrite legacy rows
 *
 * Against Railway, prefix with: railway run --service contivo-api
 * The Prisma schema (contivo in production) comes from DATABASE_URL's ?schema=.
 *
 * Safety:
 *   - Prints counts only: never a token, never a row id.
 *   - Take a database snapshot first (a Neon branch). --apply replaces the
 *     only copy of each token.
 *   - A legacy value is only rewritten if it decodes to a valid Bearer token
 *     string (RFC 6750 b64token). A wrong SOCIAL_TOKEN_SECRET decodes to
 *     noise, so those rows are counted (implausibleDecode) and left untouched,
 *     still recoverable with the right secret. Run the dry run first: a
 *     non-zero implausibleDecode means stop.
 *   - Each new value is decrypted again and compared before it is written.
 *   - The update is conditional on the row still holding the values that were
 *     read, so a token refreshed concurrently is never overwritten.
 *   - Idempotent: v1 values are skipped, so a second run updates nothing.
 */

import { PrismaClient } from '@prisma/client';

import {
  decryptToken,
  encryptToken,
  getSocialTokenSecret,
  isLegacy,
} from '../src/modules/social/token-crypto';

// RFC 6750 b64token, the grammar of a Bearer token, which every provider here
// issues (LinkedIn, X, Facebook, TikTok). XOR under the wrong key turns most
// characters into control bytes or punctuation outside this set, so a long
// token passing it by accident is very unlikely. It is a heuristic, not proof:
// take a database snapshot before --apply.
const PLAUSIBLE_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

type Mode = 'dry-run' | 'apply';

function parseMode(argv: string[]): Mode {
  const args = argv.slice(2);
  for (const a of args) {
    if (a !== '--apply' && a !== '--dry-run') {
      throw new Error(`Unknown argument: ${a}. Use --dry-run (default) or --apply.`);
    }
  }
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Pass either --dry-run or --apply, not both.');
  }
  return args.includes('--apply') ? 'apply' : 'dry-run';
}

/** Decodes a legacy value and re-encrypts it, or returns null if it does not look like a token. */
function convert(ref: string | null): { next: string | null; changed: boolean; ok: boolean } {
  if (ref === null || !isLegacy(ref)) return { next: ref, changed: false, ok: true };
  const plain = decryptToken(ref);
  if (!PLAUSIBLE_TOKEN.test(plain)) return { next: ref, changed: false, ok: false };
  const next = encryptToken(plain);
  if (decryptToken(next) !== plain) throw new Error('Round-trip check failed');
  return { next, changed: true, ok: true };
}

async function main() {
  const mode = parseMode(process.argv);
  getSocialTokenSecret(); // fail before touching the database

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.socialConnection.findMany({
      select: { id: true, encryptedAccessTokenRef: true, encryptedRefreshTokenRef: true },
    });

    const counts = {
      total: rows.length,
      withAnyToken: 0,
      legacyAccess: 0,
      legacyRefresh: 0,
      v1Access: 0,
      v1Refresh: 0,
      wouldUpdate: 0,
      implausibleDecode: 0,
      updated: 0,
      skippedChangedConcurrently: 0,
      failed: 0,
    };

    for (const row of rows) {
      const a = row.encryptedAccessTokenRef;
      const r = row.encryptedRefreshTokenRef;
      if (a !== null || r !== null) counts.withAnyToken++;
      if (a !== null) (isLegacy(a) ? counts.legacyAccess++ : counts.v1Access++);
      if (r !== null) (isLegacy(r) ? counts.legacyRefresh++ : counts.v1Refresh++);

      const needs = (a !== null && isLegacy(a)) || (r !== null && isLegacy(r));
      if (!needs) continue;

      try {
        const access = convert(a);
        const refresh = convert(r);
        if (!access.ok || !refresh.ok) {
          counts.implausibleDecode++;
          continue;
        }
        counts.wouldUpdate++;
        if (mode === 'dry-run') continue;

        const result = await prisma.socialConnection.updateMany({
          where: { id: row.id, encryptedAccessTokenRef: a, encryptedRefreshTokenRef: r },
          data: { encryptedAccessTokenRef: access.next, encryptedRefreshTokenRef: refresh.next },
        });
        if (result.count === 1) counts.updated++;
        else counts.skippedChangedConcurrently++;
      } catch {
        // Deliberately no detail: the error could carry token material.
        counts.failed++;
      }
    }

    console.log(`mode: ${mode}`);
    for (const [k, v] of Object.entries(counts)) {
      if (mode === 'dry-run' && (k === 'updated' || k === 'skippedChangedConcurrently')) continue;
      console.log(`${k}: ${v}`);
    }
    if (counts.implausibleDecode > 0) {
      console.log(
        'WARNING: some legacy values do not decode to token text. SOCIAL_TOKEN_SECRET is probably not the value ' +
          'they were written with. Those rows were not changed.',
      );
    }
    if (counts.failed > 0 || counts.implausibleDecode > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // Config and argument errors only reach here; their messages hold no secrets.
  console.error(err instanceof Error ? err.message : 'Failed');
  process.exit(1);
});

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * NOTE: migration `20260926000000_competitor_discovery` is now the source
 * of truth for this index — a fresh database (or `prisma migrate deploy`
 * in production) gets it from that migration file, not from running this
 * script. This script still exists for a database that already has the
 * `discovery_runs` table from a `db push` done before that migration was
 * written (this repo's local dev database, at the time this note was
 * added) but was never baselined onto it — running this script there is
 * equivalent to what the migration's own `CREATE UNIQUE INDEX IF NOT
 * EXISTS` statement would do, so it does not conflict with later running
 * `prisma migrate resolve --applied 20260926000000_competitor_discovery`
 * (or, on a database that runs the migration for real, `migrate deploy`)
 * on the same database.
 *
 * Adds a partial unique index enforcing "at most one PENDING/RUNNING
 * DiscoveryRun per workspace" at the database level.
 *
 * `startCompetitorDiscovery` (apps/web/src/app/actions/growth-competitors.ts)
 * already checks-then-creates: it looks for an active run, and only creates
 * a new one if none was found. That is a real gap under concurrency — two
 * requests for the same workspace can both pass the check before either has
 * written its row, and both would then create a PENDING run. This index is
 * the actual guarantee; the action's own check just avoids paying for a
 * failed insert in the overwhelmingly common case, and a `P2002` from this
 * index (caught in `startCompetitorDiscovery`) is what makes the two agree
 * on the error the caller sees.
 *
 * This can't be expressed in schema.prisma: Prisma's schema language has no
 * partial-index syntax (a `WHERE` clause on a `@@unique`), so it can never
 * appear as a generated migration or `db push` diff. This repo's own
 * precedent for raw, idempotent, `IF NOT EXISTS`-guarded DDL applied outside
 * the normal migrate/push flow is `apps/web/src/lib/activity-log.ts`'s
 * `ensureTables` (lazy `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
 * EXISTS` run from application code on first use). A one-off DDL change
 * like this one is better run once, deliberately, than lazily on some
 * request's critical path — hence a standalone script, following
 * `backfill-target-market.ts`'s shape, rather than an `ensureTables`-style
 * runtime hook.
 *
 * `IF NOT EXISTS` makes this safe to run more than once (and safe to run
 * against a database that already has the index, e.g. because someone else
 * already ran it). It is purely additive — it creates one index and touches
 * no data — so it does not need `--accept-data-loss` or any Prisma migrate
 * step; it just needs a Postgres connection with permission to create an
 * index on `discovery_runs`.
 *
 * Run once per environment: `npx ts-node apps/api/prisma/add-discovery-run-active-constraint.ts`
 * (from apps/api, with DATABASE_URL pointed at that environment).
 */
async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_runs_one_active_per_workspace
    ON discovery_runs ("workspaceId")
    WHERE status IN ('PENDING', 'RUNNING')
  `);
  console.log('discovery_runs_one_active_per_workspace: index present.');
}

main()
  .catch((e) => {
    console.error('Adding the discovery-run active-run constraint failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * set-user-cohort.ts
 *
 * Tags existing users with a cohort (users.cohort), e.g. a mentee team that
 * signed up before the ?cohort= link existed.
 *
 * Run from apps/api, with DATABASE_URL in the env:
 *
 *   cd apps/api
 *   pnpm exec ts-node scripts/set-user-cohort.ts --cohort mentees-2026-11 --emails a@b.com,c@d.com
 *   pnpm exec ts-node scripts/set-user-cohort.ts --cohort mentees-2026-11 --user-ids id1,id2
 *   ... add --apply to write. Without it, nothing is written (dry run).
 *
 * Against Railway, prefix with: railway run --service contivo-api
 * The Prisma schema (contivo in production) comes from DATABASE_URL's ?schema=.
 *
 * Safety:
 *   - Prints the datasource host first, so you see which database you hit.
 *   - Prints counts and masked emails (f***@gmail.com) only: never a full
 *     email, never a user id.
 *   - Overwrites a different existing cohort; the dry run counts those
 *     (changingFromOtherCohort) so you can stop first.
 *   - Idempotent: users already in the cohort are skipped.
 */

import { PrismaClient } from '@prisma/client';

export const COHORT_PATTERN = /^[a-z0-9][a-z0-9-_]{0,39}$/;

export type Selector = { kind: 'emails'; values: string[] } | { kind: 'userIds'; values: string[] };

export interface Options {
  cohort: string;
  selector: Selector;
  apply: boolean;
}

function splitList(raw: string): string[] {
  return [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0))];
}

export function parseArgs(args: string[]): Options {
  let cohort: string | undefined;
  let emails: string | undefined;
  let userIds: string | undefined;
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const takeValue = (): string => {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value.`);
      i++;
      return v;
    };
    if (a === '--cohort') cohort = takeValue();
    else if (a === '--emails') emails = takeValue();
    else if (a === '--user-ids') userIds = takeValue();
    else if (a === '--apply') apply = true;
    else if (a === '--dry-run') apply = false;
    else throw new Error(`Unknown argument: ${a}`);
  }

  if (!cohort) throw new Error('--cohort <tag> is required.');
  if (!COHORT_PATTERN.test(cohort)) {
    throw new Error('Invalid --cohort: use 1-40 chars of a-z, 0-9, "-" or "_", starting with a letter or digit.');
  }
  if ((emails === undefined) === (userIds === undefined)) {
    throw new Error('Pass exactly one of --emails or --user-ids.');
  }

  const selector: Selector =
    emails !== undefined
      ? { kind: 'emails', values: splitList(emails.toLowerCase()) }
      : { kind: 'userIds', values: splitList(userIds as string) };
  if (selector.values.length === 0) throw new Error('The list is empty.');
  if (selector.kind === 'emails' && selector.values.some((e) => !e.includes('@'))) {
    throw new Error('Every --emails entry must contain "@".');
  }
  return { cohort, selector, apply };
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** Host, port, database and schema only: never credentials. */
export function describeDatasource(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '?';
    const schema = u.searchParams.get('schema') ?? 'public';
    return `${u.hostname}${u.port ? `:${u.port}` : ''} db=${db} schema=${schema}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`datasource: ${describeDatasource(process.env.DATABASE_URL)}`);
  console.log(`mode: ${opts.apply ? 'apply' : 'dry-run'}`);
  console.log(`cohort: ${opts.cohort}`);

  const prisma = new PrismaClient();
  try {
    const where =
      opts.selector.kind === 'emails'
        ? { email: { in: opts.selector.values, mode: 'insensitive' as const } }
        : { id: { in: opts.selector.values } };
    const users = await prisma.user.findMany({ where, select: { id: true, email: true, cohort: true } });

    const matchedKeys = new Set(
      users.map((u) => (opts.selector.kind === 'emails' ? u.email.toLowerCase() : u.id)),
    );
    const notFound = opts.selector.values.filter((v) => !matchedKeys.has(v));
    const already = users.filter((u) => u.cohort === opts.cohort);
    const toChange = users.filter((u) => u.cohort !== opts.cohort);
    const fromOther = toChange.filter((u) => u.cohort !== null);

    console.log(`requested: ${opts.selector.values.length}`);
    console.log(`matched: ${users.length}`);
    console.log(`notFound: ${notFound.length}`);
    if (opts.selector.kind === 'emails' && notFound.length > 0) {
      console.log(`notFoundEmails: ${notFound.map(maskEmail).join(', ')}`);
    }
    console.log(`alreadyInCohort: ${already.length}`);
    console.log(`wouldChange: ${toChange.length}`);
    console.log(`changingFromOtherCohort: ${fromOther.length}`);
    console.log(`matchedEmails: ${users.map((u) => maskEmail(u.email)).join(', ') || '(none)'}`);

    if (!opts.apply) {
      console.log('dry run: nothing written. Re-run with --apply to write.');
      return;
    }
    if (toChange.length === 0) {
      console.log('updated: 0');
      return;
    }
    const result = await prisma.user.updateMany({
      where: { id: { in: toChange.map((u) => u.id) } },
      data: { cohort: opts.cohort },
    });
    console.log(`updated: ${result.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Argument and connection errors only; never echo a row.
    console.error(err instanceof Error ? err.message : 'Failed');
    process.exit(1);
  });
}

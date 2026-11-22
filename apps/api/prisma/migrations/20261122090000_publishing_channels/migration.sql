-- Publishing channels (Telegram, Threads). Additive only: four enum values
-- and one nullable column without a default (no table rewrite, no backfill).
-- WordPress is deliberately not here; it gets its own PR if it needs schema.
--
-- Enum adds: Postgres 12+ allows ADD VALUE inside the transaction Prisma runs
-- this file in, but the new values cannot be USED in that same transaction.
-- This file only adds them. IF NOT EXISTS makes a re-run harmless.
-- Schema-unqualified on purpose: resolves via ?schema= (contivo in prod).
--
-- Rollback: Postgres cannot drop an enum value. Leaving the unused values in
-- place is harmless; to remove them you must recreate the type (rename old,
-- create new without the values, ALTER COLUMN ... TYPE ... USING ::text, drop
-- old) after deleting/updating every row that uses them. Column rollback:
--   ALTER TABLE "social_connections" DROP COLUMN "metaJson";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261122090000_publishing_channels';

-- AlterEnum
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'TELEGRAM';
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'THREADS';

-- AlterEnum
ALTER TYPE "ContentChannel" ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE "ContentChannel" ADD VALUE IF NOT EXISTS 'threads';

-- AlterTable
ALTER TABLE "social_connections" ADD COLUMN IF NOT EXISTS "metaJson" JSONB;

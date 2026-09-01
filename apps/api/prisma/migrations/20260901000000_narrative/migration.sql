-- Phase 5 · Narrative. Three tables, because evidence outlives any one narrative:
-- regenerating the storylines must not throw away what the company can prove.

CREATE TYPE "EvidenceKind" AS ENUM (
  'CUSTOMER_COUNT', 'PUBLIC_NUMBER', 'NAMED_CUSTOMER', 'FIRSTHAND_EXPERIENCE', 'FORBIDDEN_CLAIM'
);
CREATE TYPE "NarrativeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ChangeSource" AS ENUM ('PROPOSED', 'EDITED', 'HUMAN');

CREATE TABLE "evidence" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind"        "EvidenceKind" NOT NULL,
  "value"       TEXT NOT NULL,
  "detail"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "evidence_workspaceId_idx" ON "evidence"("workspaceId");
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "narratives" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "status"         "NarrativeStatus" NOT NULL DEFAULT 'DRAFT',
  "change"         TEXT,
  "changeSource"   "ChangeSource" NOT NULL DEFAULT 'PROPOSED',
  "changeOptions"  JSONB,
  "sourceSnapshot" JSONB,
  "generatedBy"    TEXT,
  "generatedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "narratives_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "narratives_workspaceId_key" ON "narratives"("workspaceId");
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "storylines" (
  "id"           TEXT NOT NULL,
  "narrativeId"  TEXT NOT NULL,
  "winners"      TEXT,
  "losers"       TEXT,
  "promisedLand" TEXT NOT NULL,
  "gifts"        JSONB,
  "evidenceIds"  TEXT[],
  "claim"        TEXT NOT NULL,
  "audience"     TEXT,
  "sourceRefs"   JSONB,
  "neverClaim"   TEXT[],
  "position"     INTEGER NOT NULL DEFAULT 0,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storylines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "storylines_narrativeId_idx" ON "storylines"("narrativeId");
ALTER TABLE "storylines" ADD CONSTRAINT "storylines_narrativeId_fkey"
  FOREIGN KEY ("narrativeId") REFERENCES "narratives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable on purpose: content created before this layer existed has no storyline
-- and must keep working.
ALTER TABLE "content_items" ADD COLUMN "storylineId" TEXT;
CREATE INDEX "content_items_storylineId_idx" ON "content_items"("storylineId");
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_storylineId_fkey"
  FOREIGN KEY ("storylineId") REFERENCES "storylines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

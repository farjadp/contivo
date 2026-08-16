-- CreateEnum
CREATE TYPE "AutopilotRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "autopilot_policies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "channels" "ContentChannel"[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "windowStartHour" INTEGER NOT NULL DEFAULT 9,
    "windowEndHour" INTEGER NOT NULL DEFAULT 18,
    "publishDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "goal" TEXT,
    "topicHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoidTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_runs" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "AutopilotRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "ideasGenerated" INTEGER NOT NULL DEFAULT 0,
    "itemsScheduled" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "autopilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_policies_workspaceId_key" ON "autopilot_policies"("workspaceId");

-- CreateIndex
CREATE INDEX "autopilot_policies_enabled_nextRunAt_idx" ON "autopilot_policies"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "autopilot_policies_userId_idx" ON "autopilot_policies"("userId");

-- CreateIndex
CREATE INDEX "autopilot_runs_workspaceId_startedAt_idx" ON "autopilot_runs"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "autopilot_runs_policyId_idx" ON "autopilot_runs"("policyId");

-- AddForeignKey
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "autopilot_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


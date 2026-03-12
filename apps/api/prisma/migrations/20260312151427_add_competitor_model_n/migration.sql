-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "category" TEXT,
    "audienceGuess" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "type" TEXT,
    "userDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitors_workspaceId_idx" ON "competitors"("workspaceId");

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

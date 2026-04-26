export const QUEUES = {
  CONTENT_FAST: 'contivo-content-fast',
  CRAWL: 'contivo-crawl',
  ANALYSIS: 'contivo-analysis',
  STRATEGY: 'contivo-strategy',
  PUBLISH: 'contivo-publish',
  BILLING: 'contivo-billing',
} as const;

export interface BaseJobPayload {
  userId: string;
  workspaceId?: string;
  jobRecordId: string; // ID of the DB record tracking this job (Prisma ContentJob / StrategyRun etc)
  traceId?: string;    // E.g., request ID for tracing
  retryCount?: number;
  entityId?: string;   // Optional related entity (e.g., contentItemId)
  metadata?: any;      // Arbitrary data passed to the worker
}

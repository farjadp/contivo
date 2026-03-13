import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
  getBrandMemoryRescrapeLimit,
  getCompetitiveLandscapeLimit,
  getContentWordCountLimits,
  getDefaultScheduleDelayHours,
  getGeminiCooldownSeconds,
  getGeminiModel,
  getIdeationMaxContentCount,
  getOpenAiFallbackModel,
} from '@/lib/app-settings';
import { listUserAccessStates, listWorkspaceArchiveStates } from '@/lib/admin-state';
import { getFrameworkUsageSummary, listRecentFrameworkMetadata } from '@/lib/framework-metadata-log';
import { listAllActivityLogs } from '@/lib/activity-log';

export type AdminSection =
  | 'overview'
  | 'users'
  | 'workspaces'
  | 'ai'
  | 'settings'
  | 'credits'
  | 'content'
  | 'jobs'
  | 'logs'
  | 'analytics'
  | 'integrations';

const DEFAULT_LOOKBACK_DAYS = 30;

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: Date;
  updatedAt: Date;
  subscription: {
    status: string;
    plan: string;
  } | null;
  _count: {
    workspaces: number;
    contentItems: number;
    aiUsageLogs: number;
  };
};

function startOfDay(date = new Date()): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function countWords(value: string | null | undefined): number {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length;
}

export function resolveAdminSection(rawValue: string | string[] | undefined): AdminSection {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const allowed = new Set<AdminSection>([
    'overview',
    'users',
    'workspaces',
    'ai',
    'settings',
    'credits',
    'content',
    'jobs',
    'logs',
    'analytics',
    'integrations',
  ]);
  if (!value || !allowed.has(value as AdminSection)) return 'overview';
  return value as AdminSection;
}

export async function getAdminOverview() {
  const since = daysAgo(DEFAULT_LOOKBACK_DAYS);
  const today = startOfDay();
  const databaseLatencyStartedAt = Date.now();

  const [
    databaseLatencyMs,
    totalUsers,
    activeUsers,
    activeUsersToday,
    payingUsers,
    totalWorkspaces,
    activeWorkspaces,
    aiJobsToday,
    failedAiJobsToday,
    creditsUsedToday,
    estimatedAiCostToday,
    scheduledContentCount,
    contentGeneratedToday,
    publishedContentToday,
    pendingJobs,
    runningJobs,
    failedJobs,
    recentFailedJobs,
    topFrameworks,
    completedJobsToday,
  ] = await Promise.all([
    prisma.$queryRaw`SELECT 1`
      .then(() => Date.now() - databaseLatencyStartedAt)
      .catch(() => null),
    prisma.user.count(),
    prisma.user.count({
      where: {
        OR: [
          { updatedAt: { gte: since } },
          { workspaces: { some: { updatedAt: { gte: since } } } },
          { contentItems: { some: { createdAt: { gte: since } } } },
          { aiUsageLogs: { some: { createdAt: { gte: since } } } },
        ],
      },
    }),
    prisma.user.count({
      where: {
        OR: [
          { updatedAt: { gte: today } },
          { workspaces: { some: { updatedAt: { gte: today } } } },
          { contentItems: { some: { createdAt: { gte: today } } } },
          { aiUsageLogs: { some: { createdAt: { gte: today } } } },
        ],
      },
    }),
    prisma.user.count({
      where: {
        subscription: {
          is: {
            plan: { not: 'FREE' },
            status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
          },
        },
      },
    }),
    prisma.workspace.count(),
    prisma.workspace.count({
      where: {
        OR: [
          { updatedAt: { gte: since } },
          { contentItems: { some: { createdAt: { gte: since } } } },
          { competitors: { some: { createdAt: { gte: since } } } },
        ],
      },
    }),
    prisma.contentJob.count({
      where: {
        createdAt: { gte: today },
      },
    }),
    prisma.contentJob.count({
      where: {
        createdAt: { gte: today },
        status: 'FAILED',
      },
    }),
    prisma.creditLedger.aggregate({
      where: {
        createdAt: { gte: today },
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: {
        createdAt: { gte: today },
      },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.contentItem.count({
      where: { status: 'SCHEDULED' },
    }),
    prisma.contentItem.count({
      where: {
        createdAt: { gte: today },
      },
    }),
    prisma.contentItem.count({
      where: {
        status: 'PUBLISHED',
        publishedAtUtc: { gte: today },
      },
    }),
    prisma.contentJob.count({ where: { status: 'PENDING' } }),
    prisma.contentJob.count({ where: { status: 'RUNNING' } }),
    prisma.contentJob.count({ where: { status: 'FAILED' } }),
    prisma.contentJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: {
        user: { select: { email: true } },
        workspace: { select: { name: true } },
      },
    }),
    getFrameworkUsageSummary(30),
    prisma.contentJob.findMany({
      where: {
        createdAt: { gte: today },
        status: 'COMPLETED',
        completedAt: { not: null },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  const averageGenerationTimeMs =
    completedJobsToday.length > 0
      ? Math.round(
          completedJobsToday.reduce((total, job) => {
            const completedAt = job.completedAt?.getTime() || job.createdAt.getTime();
            return total + Math.max(0, completedAt - job.createdAt.getTime());
          }, 0) / completedJobsToday.length,
        )
      : 0;

  return {
    metrics: {
      databaseLatencyMs: databaseLatencyMs ?? 0,
      totalUsers,
      activeUsers,
      activeUsersToday,
      payingUsers,
      freeUsers: Math.max(0, totalUsers - payingUsers),
      totalWorkspaces,
      activeWorkspaces,
      aiJobsToday,
      failedAiJobsToday,
      averageGenerationTimeMs,
      creditsUsedToday: Math.abs(creditsUsedToday._sum.amount ?? 0),
      estimatedAiCostToday: toNumber(estimatedAiCostToday._sum.estimatedCostUsd),
      scheduledContentCount,
      contentGeneratedToday,
      publishedContentToday,
      pendingJobs,
      runningJobs,
      failedJobs,
    },
    recentFailedJobs,
    topFrameworks: topFrameworks.slice(0, 5),
    health: {
      database: databaseLatencyMs == null ? 'FAILED' : 'healthy',
      jobs: failedJobs > 0 ? 'warning' : 'healthy',
      provider: failedAiJobsToday > 0 ? 'warning' : 'healthy',
    },
  };
}

export async function getAdminUsers(input: {
  query?: string;
  plan?: string;
  role?: string;
  status?: string;
}) {
  const where: Prisma.UserWhereInput = {};
  const query = String(input.query || '').trim();
  if (query) {
    where.OR = [
      { email: { contains: query, mode: 'insensitive' } },
      { name: { contains: query, mode: 'insensitive' } },
      { id: { contains: query, mode: 'insensitive' } },
      { clerkId: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (input.plan && input.plan !== 'ALL') {
    where.plan = input.plan as any;
  }
  if (input.role && input.role !== 'ALL') {
    where.role = input.role as any;
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      subscription: {
        select: {
          status: true,
          plan: true,
        },
      },
      _count: {
        select: {
          workspaces: true,
          contentItems: true,
          aiUsageLogs: true,
        },
      },
    },
  });

  const [ledgerGroups, aiUsageGroups, latestContent, latestJobs, accessStates] = await Promise.all([
    prisma.creditLedger.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) } },
      _sum: { amount: true },
      _max: { createdAt: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) } },
      _sum: { estimatedCostUsd: true },
      _max: { createdAt: true },
    }),
    prisma.contentItem.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) } },
      _max: { createdAt: true },
    }),
    prisma.contentJob.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) } },
      _max: { createdAt: true },
    }),
    listUserAccessStates(users.map((user) => user.id)),
  ]);

  const balanceMap = new Map(ledgerGroups.map((entry) => [entry.userId, entry._sum.amount ?? 0]));
  const aiCostMap = new Map(
    aiUsageGroups.map((entry) => [entry.userId, toNumber(entry._sum.estimatedCostUsd)]),
  );
  const contentLastMap = new Map(latestContent.map((entry) => [entry.userId, entry._max.createdAt]));
  const jobsLastMap = new Map(latestJobs.map((entry) => [entry.userId, entry._max.createdAt]));
  const aiLastMap = new Map(aiUsageGroups.map((entry) => [entry.userId, entry._max.createdAt]));

  const rows = (users as UserRow[]).map((user) => {
    const candidates = [
      user.updatedAt,
      contentLastMap.get(user.id) || null,
      jobsLastMap.get(user.id) || null,
      aiLastMap.get(user.id) || null,
    ].filter(Boolean) as Date[];
    const lastActiveAt = candidates.sort((a, b) => b.getTime() - a.getTime())[0] || user.createdAt;

    return {
      ...user,
      accountStatus: accessStates.get(user.id)?.status || 'ACTIVE',
      suspendedReason: accessStates.get(user.id)?.suspendedReason || null,
      creditBalance: balanceMap.get(user.id) ?? 0,
      totalAiCost: aiCostMap.get(user.id) ?? 0,
      lastActiveAt,
    };
  });

  if (input.status && input.status !== 'ALL') {
    return rows.filter((row) => row.accountStatus === input.status);
  }

  return rows;
}

export async function getAdminWorkspaces(input: {
  query?: string;
  status?: string;
  ownerId?: string;
}) {
  const where: Prisma.WorkspaceWhereInput = {};
  const query = String(input.query || '').trim();
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { websiteUrl: { contains: query, mode: 'insensitive' } },
      { id: { contains: query, mode: 'insensitive' } },
      { user: { email: { contains: query, mode: 'insensitive' } } },
    ];
  }
  if (input.status && input.status !== 'ALL') {
    if (input.status !== 'ARCHIVED') {
      where.status = input.status as any;
    }
  }
  if (input.ownerId && input.ownerId !== 'ALL') {
    where.userId = input.ownerId;
  }

  const rows = await prisma.workspace.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 60,
    include: {
      user: { select: { id: true, email: true, name: true } },
      _count: {
        select: {
          competitors: true,
          contentItems: true,
          strategyRuns: true,
          competitorKeywords: true,
          keywordOpportunities: true,
          serpAnalyses: true,
        },
      },
    },
  });

  const archiveStates = await listWorkspaceArchiveStates(rows.map((row) => row.id));
  const enrichedRows = rows.map((row) => ({
    ...row,
    archiveState: archiveStates.get(row.id) || null,
  }));

  if (input.status === 'ARCHIVED') {
    return enrichedRows.filter((row) => row.archiveState?.isArchived);
  }

  return enrichedRows;
}

export async function getAdminContentItems(input: {
  query?: string;
  status?: string;
  channel?: string;
  workspaceId?: string;
}) {
  const where: Prisma.ContentItemWhereInput = {};
  const query = String(input.query || '').trim();
  if (query) {
    where.OR = [
      { topic: { contains: query, mode: 'insensitive' } },
      { id: { contains: query, mode: 'insensitive' } },
      { workspace: { name: { contains: query, mode: 'insensitive' } } },
    ];
  }
  if (input.status && input.status !== 'ALL') {
    where.status = input.status as any;
  }
  if (input.channel && input.channel !== 'ALL') {
    where.channel = input.channel as any;
  }
  if (input.workspaceId && input.workspaceId !== 'ALL') {
    where.workspaceId = input.workspaceId;
  }

  const rows = await prisma.contentItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      user: { select: { email: true } },
      workspace: { select: { name: true } },
    },
  });

  return rows.map((item) => ({
    ...item,
    wordCount: countWords(item.content),
  }));
}

export async function getAdminJobs(input: {
  status?: string;
  type?: string;
}) {
  const where: Prisma.ContentJobWhereInput = {};
  if (input.status && input.status !== 'ALL') {
    where.status = input.status as any;
  }
  if (input.type && input.type !== 'ALL') {
    where.type = input.type as any;
  }

  const rows = await prisma.contentJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      user: { select: { email: true } },
      workspace: { select: { name: true } },
    },
  });

  return rows.map((job) => ({
    ...job,
    durationMs: job.completedAt ? job.completedAt.getTime() - job.createdAt.getTime() : null,
  }));
}

export async function getAdminCreditLedger(userId?: string) {
  return prisma.creditLedger.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 120,
    include: {
      user: { select: { email: true, name: true } },
    },
  });
}

export async function getAdminAnalytics() {
  const since = daysAgo(DEFAULT_LOOKBACK_DAYS);
  const [frameworks, platforms, aiCostByFeature, contentStatusBreakdown, recentFrameworkEvents] =
    await Promise.all([
      getFrameworkUsageSummary(30),
      prisma.contentItem.groupBy({
        by: ['channel'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: since } },
        _sum: { estimatedCostUsd: true, totalTokens: true },
      }),
      prisma.contentItem.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      listRecentFrameworkMetadata(40),
    ]);

  return {
    frameworks: frameworks.slice(0, 10),
    platforms: platforms.map((entry) => ({
      channel: entry.channel,
      count: entry._count._all,
    })),
    aiCostByFeature: aiCostByFeature.map((entry) => ({
      feature: entry.feature,
      costUsd: toNumber(entry._sum.estimatedCostUsd),
      totalTokens: entry._sum.totalTokens ?? 0,
    })),
    contentStatusBreakdown: contentStatusBreakdown.map((entry) => ({
      status: entry.status,
      count: entry._count._all,
    })),
    recentFrameworkEvents,
  };
}

export async function getAdminLogs() {
  const [activityLogs, adminAuditLogs] = await Promise.all([
    listAllActivityLogs(120),
    listAllActivityLogs(120, 'ADMIN_'),
  ]);

  return {
    activityLogs,
    adminAuditLogs,
  };
}

export async function getAdminIntegrations() {
  const [keywordRows, serpRows, aiUsageLastDay] = await Promise.all([
    prisma.competitorKeyword.count(),
    prisma.serpAnalysis.count(),
    prisma.aiUsageLog.groupBy({
      by: ['model'],
      where: { createdAt: { gte: daysAgo(1) } },
      _count: { _all: true },
      _sum: { estimatedCostUsd: true },
    }),
  ]);

  return {
    providers: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      redisConfigured: Boolean(process.env.REDIS_URL),
      dataForSeoConfigured: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
    },
    seoData: {
      keywordRows,
      serpRows,
    },
    aiUsageLastDay: aiUsageLastDay.map((entry) => ({
      model: entry.model,
      requests: entry._count._all,
      costUsd: toNumber(entry._sum.estimatedCostUsd),
    })),
  };
}

export async function getAdminSettingsState() {
  const [
    geminiModel,
    openAiFallbackModel,
    geminiCooldownSeconds,
    competitiveLandscapeLimit,
    brandMemoryLimit,
    ideationMaxContentCount,
    defaultScheduleDelayHours,
    wordCountLimits,
  ] = await Promise.all([
    getGeminiModel(),
    getOpenAiFallbackModel(),
    getGeminiCooldownSeconds(),
    getCompetitiveLandscapeLimit(),
    getBrandMemoryRescrapeLimit(),
    getIdeationMaxContentCount(),
    getDefaultScheduleDelayHours(),
    getContentWordCountLimits(),
  ]);

  return {
    geminiModel,
    openAiFallbackModel,
    geminiCooldownSeconds,
    competitiveLandscapeLimit,
    brandMemoryLimit,
    ideationMaxContentCount,
    defaultScheduleDelayHours,
    wordCountLimits,
  };
}

'use server';

import { Prisma } from '@prisma/client';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';
import {
  archiveWorkspace,
  reactivateUser,
  restoreWorkspace,
  suspendUser,
} from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import {
  GEMINI_COOLDOWN_SECONDS_MAX,
  GEMINI_COOLDOWN_SECONDS_MIN,
  SCHEDULE_DELAY_HOURS_MAX,
  SCHEDULE_DELAY_HOURS_MIN,
  getDefaultScheduleDelayHours,
  getContentWordCountLimits,
  getIdeationMaxContentCount,
  PLATFORM_LIMIT_MAX,
  PLATFORM_LIMIT_MIN,
  setBrandMemoryRescrapeLimit,
  setContentWordCountLimits,
  setCompetitiveLandscapeLimit,
  setDefaultScheduleDelayHours,
  setGeminiCooldownSeconds,
  setGeminiModel,
  setIdeationMaxContentCount,
  setOpenAiFallbackModel,
} from '@/lib/app-settings';
import {
  WORD_COUNT_LIMIT_ABSOLUTE_MAX,
  WORD_COUNT_LIMIT_ABSOLUTE_MIN,
  WORD_COUNT_PLATFORMS,
  type ContentWordCountLimits,
} from '@/lib/content-word-count';

const MODEL_PATTERN = /^[a-zA-Z0-9._-]+$/;

function toDateOrNull(unixSeconds: number | null | undefined): Date | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  return session;
}

async function writeAdminAudit(session: { userId: string }, action: string, detail: Record<string, unknown>) {
  await writeActivityLog({
    userId: session.userId,
    action: `ADMIN_${action}`,
    detail,
  });
}

export async function updateGeminiModel(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const model = String(formData.get('geminiModel') || '').trim();
  if (!model) {
    redirect('/admin?settings=empty');
  }

  if (model.length > 120 || !MODEL_PATTERN.test(model)) {
    redirect('/admin?settings=invalid');
  }

  try {
    await setGeminiModel(model);
    await writeAdminAudit(session, 'GEMINI_MODEL_UPDATED', { model });
  } catch (error) {
    console.error('Failed to update Gemini model from admin:', error);
    redirect('/admin?settings=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?settings=saved');
}

function parseLimit(value: FormDataEntryValue | null): number | null {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < PLATFORM_LIMIT_MIN || parsed > PLATFORM_LIMIT_MAX) return null;
  return parsed;
}

function parseWordCount(value: FormDataEntryValue | null): number | null {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < WORD_COUNT_LIMIT_ABSOLUTE_MIN || parsed > WORD_COUNT_LIMIT_ABSOLUTE_MAX) return null;
  return parsed;
}

export async function updatePlatformLimits(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const redirectToRaw = String(formData.get('redirectTo') || '/admin');
  const redirectBase = redirectToRaw === '/settings' ? '/settings' : '/admin';

  const competitiveLimit = parseLimit(formData.get('competitiveLandscapeLimit'));
  const brandMemoryLimit = parseLimit(formData.get('brandMemoryLimit'));
  const ideationMaxContentCountRaw = formData.get('ideationMaxContentCount');
  const ideationMaxContentCountParsed = ideationMaxContentCountRaw == null ? null : parseLimit(ideationMaxContentCountRaw);
  const scheduleDelayRaw = formData.get('defaultScheduleDelayHours');
  const scheduleDelayParsed =
    scheduleDelayRaw == null
      ? null
      : Number.isInteger(Number(String(scheduleDelayRaw).trim()))
        ? Math.max(
            SCHEDULE_DELAY_HOURS_MIN,
            Math.min(SCHEDULE_DELAY_HOURS_MAX, Number(String(scheduleDelayRaw).trim())),
          )
        : null;

  if (
    competitiveLimit == null ||
    brandMemoryLimit == null ||
    (ideationMaxContentCountRaw != null && ideationMaxContentCountParsed == null) ||
    (scheduleDelayRaw != null && scheduleDelayParsed == null)
  ) {
    redirect(`${redirectBase}?limits=invalid`);
  }

  const ideationMaxContentCount =
    ideationMaxContentCountParsed == null
      ? await getIdeationMaxContentCount()
      : ideationMaxContentCountParsed;
  const defaultScheduleDelayHours =
    scheduleDelayParsed == null
      ? await getDefaultScheduleDelayHours()
      : scheduleDelayParsed;

  const currentWordCountLimits = await getContentWordCountLimits();
  const nextWordCountLimits: ContentWordCountLimits = { ...currentWordCountLimits };
  for (const platform of WORD_COUNT_PLATFORMS) {
    const minRaw = formData.get(`wordMin_${platform}`);
    const maxRaw = formData.get(`wordMax_${platform}`);

    if (minRaw == null && maxRaw == null) continue;

    const min = parseWordCount(minRaw);
    const max = parseWordCount(maxRaw);
    if (min == null || max == null || min > max) {
      redirect(`${redirectBase}?limits=invalid`);
    }
    nextWordCountLimits[platform] = { min, max };
  }

  try {
    await Promise.all([
      setCompetitiveLandscapeLimit(competitiveLimit),
      setBrandMemoryRescrapeLimit(brandMemoryLimit),
      setIdeationMaxContentCount(ideationMaxContentCount),
      setDefaultScheduleDelayHours(defaultScheduleDelayHours),
      setContentWordCountLimits(nextWordCountLimits),
    ]);
    await writeAdminAudit(session, 'PLATFORM_LIMITS_UPDATED', {
      competitiveLimit,
      brandMemoryLimit,
      ideationMaxContentCount,
      defaultScheduleDelayHours,
      wordCountLimits: nextWordCountLimits,
    });
  } catch (error) {
    console.error('Failed to update platform limits from admin:', error);
    redirect(`${redirectBase}?limits=failed`);
  }

  revalidatePath('/admin');
  revalidatePath('/settings');
  revalidatePath('/growth');
  redirect(`${redirectBase}?limits=saved`);
}

export async function updateAiControls(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const geminiModel = String(formData.get('geminiModel') || '').trim();
  const openAiFallbackModel = String(formData.get('openAiFallbackModel') || '').trim();
  const cooldownRaw = Number(String(formData.get('geminiCooldownSeconds') || '').trim());

  if (
    !geminiModel ||
    !openAiFallbackModel ||
    !MODEL_PATTERN.test(geminiModel) ||
    !MODEL_PATTERN.test(openAiFallbackModel) ||
    !Number.isInteger(cooldownRaw) ||
    cooldownRaw < GEMINI_COOLDOWN_SECONDS_MIN ||
    cooldownRaw > GEMINI_COOLDOWN_SECONDS_MAX
  ) {
    redirect('/admin?section=ai&settings=invalid');
  }

  try {
    await Promise.all([
      setGeminiModel(geminiModel),
      setOpenAiFallbackModel(openAiFallbackModel),
      setGeminiCooldownSeconds(cooldownRaw),
    ]);
    await writeAdminAudit(session, 'AI_CONTROLS_UPDATED', {
      geminiModel,
      openAiFallbackModel,
      geminiCooldownSeconds: cooldownRaw,
    });
  } catch (error) {
    console.error('Failed to update AI controls from admin:', error);
    redirect('/admin?section=ai&settings=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=ai&settings=saved');
}

function parseInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

export async function updateUserAccess(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get('userId') || '').trim();
  const role = String(formData.get('role') || '').trim();
  const plan = String(formData.get('plan') || '').trim();

  if (!userId) redirect('/admin?section=users&users=invalid');

  try {
    if (role) {
      await prisma.user.update({
        where: { id: userId },
        data: { role: role as any },
      });
      await writeAdminAudit(session, 'USER_ROLE_UPDATED', { userId, role });
    }

    if (plan) {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: plan as any },
      });
      await prisma.subscription.updateMany({
        where: { userId },
        data: { plan: plan as any },
      });
      await writeAdminAudit(session, 'USER_PLAN_UPDATED', { userId, plan });
    }
  } catch (error) {
    console.error('Failed to update user access from admin:', error);
    redirect('/admin?section=users&users=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=users&users=saved');
}

export async function manageUserLifecycle(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get('userId') || '').trim();
  const actionType = String(formData.get('actionType') || '').trim();
  const reason = String(formData.get('reason') || '').trim();

  if (!userId || !actionType) {
    redirect('/admin?section=users&users=invalid');
  }

  try {
    if (actionType === 'SUSPEND') {
      await suspendUser(userId, reason || null);
      await writeAdminAudit(session, 'USER_SUSPENDED', { userId, reason: reason || null });
    } else if (actionType === 'REACTIVATE') {
      await reactivateUser(userId);
      await writeAdminAudit(session, 'USER_REACTIVATED', { userId });
    } else {
      redirect('/admin?section=users&users=invalid');
    }
  } catch (error) {
    console.error('Failed to manage user lifecycle from admin:', error);
    redirect('/admin?section=users&users=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=users&users=saved');
}

export async function adjustCredits(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get('userId') || '').trim();
  const amount = parseInteger(formData.get('amount'));
  const adjustmentType = String(formData.get('adjustmentType') || '').trim();
  const note = String(formData.get('note') || '').trim();

  if (!userId || amount == null || amount <= 0 || !adjustmentType) {
    redirect('/admin?section=credits&credits=invalid');
  }

  try {
    const aggregate = await prisma.creditLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    const currentBalance = aggregate._sum.amount ?? 0;
    const delta =
      adjustmentType === 'DEDUCT'
        ? -amount
        : amount;
    const ledgerType =
      adjustmentType === 'REFUND'
        ? 'REFUND'
        : adjustmentType === 'ALLOCATE'
          ? 'ALLOCATION'
          : adjustmentType === 'TOP_UP'
            ? 'TOP_UP'
            : 'CONSUMPTION';

    await prisma.creditLedger.create({
      data: {
        userId,
        type: ledgerType as any,
        feature: `ADMIN_${adjustmentType}`,
        amount: delta,
        balanceAfter: currentBalance + delta,
        jobId: null,
      },
    });
    await writeAdminAudit(session, 'CREDITS_ADJUSTED', {
      userId,
      adjustmentType,
      amount,
      note: note || null,
      balanceAfter: currentBalance + delta,
    });
  } catch (error) {
    console.error('Failed to adjust credits from admin:', error);
    redirect('/admin?section=credits&credits=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=credits&credits=saved');
}

export async function manageWorkspace(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const workspaceId = String(formData.get('workspaceId') || '').trim();
  const actionType = String(formData.get('actionType') || '').trim();
  const targetUserId = String(formData.get('targetUserId') || '').trim();
  const reason = String(formData.get('reason') || '').trim();

  if (!workspaceId || !actionType) {
    redirect('/admin?section=workspaces&workspaces=invalid');
  }

  try {
    if (actionType === 'REANALYZE') {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { status: 'PENDING' },
      });
      await writeAdminAudit(session, 'WORKSPACE_REANALYSIS_FORCED', { workspaceId });
    } else if (actionType === 'ARCHIVE') {
      await archiveWorkspace(workspaceId, reason || null);
      await writeAdminAudit(session, 'WORKSPACE_ARCHIVED', { workspaceId, reason: reason || null });
    } else if (actionType === 'RESTORE') {
      await restoreWorkspace(workspaceId);
      await writeAdminAudit(session, 'WORKSPACE_RESTORED', { workspaceId });
    } else if (actionType === 'TRANSFER' && targetUserId) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { userId: targetUserId },
      });
      await writeAdminAudit(session, 'WORKSPACE_TRANSFERRED', { workspaceId, targetUserId });
    } else if (actionType === 'DELETE') {
      await prisma.workspace.delete({
        where: { id: workspaceId },
      });
      await writeAdminAudit(session, 'WORKSPACE_DELETED', { workspaceId });
    } else {
      redirect('/admin?section=workspaces&workspaces=invalid');
    }
  } catch (error) {
    console.error('Failed to manage workspace from admin:', error);
    redirect('/admin?section=workspaces&workspaces=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=workspaces&workspaces=saved');
}

async function syncStripeSubscriptionToDb(userId: string) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new Error('STRIPE_SUBSCRIPTION_NOT_FOUND');
  }

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${subscription.stripeSubscriptionId}`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
      },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`STRIPE_SYNC_FAILED_${response.status}`);
  }

  const data = await response.json();
  const stripeStatus = String(data?.status || '').toUpperCase();
  const normalizedStatus =
    stripeStatus === 'ACTIVE'
      ? 'ACTIVE'
      : stripeStatus === 'TRIALING'
        ? 'TRIALING'
        : stripeStatus === 'PAST_DUE'
          ? 'PAST_DUE'
          : stripeStatus === 'CANCELED'
            ? 'CANCELED'
            : 'INCOMPLETE';

  await prisma.subscription.update({
    where: { userId },
    data: {
      status: normalizedStatus as any,
      stripePriceId: data?.items?.data?.[0]?.price?.id || subscription.stripePriceId,
      currentPeriodStart: toDateOrNull(data?.current_period_start),
      currentPeriodEnd: toDateOrNull(data?.current_period_end),
    },
  });

  return {
    stripeStatus,
    normalizedStatus,
    currentPeriodStart: toDateOrNull(data?.current_period_start),
    currentPeriodEnd: toDateOrNull(data?.current_period_end),
  };
}

export async function manageBilling(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get('userId') || '').trim();
  const actionType = String(formData.get('actionType') || '').trim();
  const plan = String(formData.get('plan') || '').trim();
  const promoCredits = parseInteger(formData.get('promoCredits'));
  const trialDays = parseInteger(formData.get('trialDays')) ?? 14;
  const note = String(formData.get('note') || '').trim();

  if (!userId || !actionType) {
    redirect('/admin?section=credits&billing=invalid');
  }

  try {
    if (actionType === 'SYNC_STRIPE') {
      const syncResult = await syncStripeSubscriptionToDb(userId);
      await writeAdminAudit(session, 'BILLING_STRIPE_SYNCED', { userId, ...syncResult });
    } else if (actionType === 'GRANT_TRIAL') {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + Math.max(1, trialDays));

      await prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          stripeCustomerId: `manual_${userId}`,
          plan: (plan || 'STARTER') as any,
          status: 'TRIALING',
          creditAllowance: 100,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          plan: (plan || 'STARTER') as any,
          status: 'TRIALING',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { plan: (plan || 'STARTER') as any },
      });
      await writeAdminAudit(session, 'BILLING_TRIAL_GRANTED', {
        userId,
        plan: plan || 'STARTER',
        trialDays,
      });
    } else if (actionType === 'APPLY_PROMO') {
      if (promoCredits == null || promoCredits <= 0) {
        redirect('/admin?section=credits&billing=invalid');
      }

      const aggregate = await prisma.creditLedger.aggregate({
        where: { userId },
        _sum: { amount: true },
      });
      const currentBalance = aggregate._sum.amount ?? 0;
      await prisma.creditLedger.create({
        data: {
          userId,
          type: 'TOP_UP',
          feature: 'ADMIN_PROMO',
          amount: promoCredits,
          balanceAfter: currentBalance + promoCredits,
          jobId: null,
        },
      });
      await writeAdminAudit(session, 'BILLING_PROMO_APPLIED', {
        userId,
        promoCredits,
        note: note || null,
        balanceAfter: currentBalance + promoCredits,
      });
    } else {
      redirect('/admin?section=credits&billing=invalid');
    }
  } catch (error) {
    console.error('Failed to manage billing from admin:', error);
    redirect('/admin?section=credits&billing=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?section=credits&billing=saved');
}

export async function manageJob(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const jobId = String(formData.get('jobId') || '').trim();
  const actionType = String(formData.get('actionType') || '').trim();

  if (!jobId || !actionType) {
    redirect('/admin?section=jobs&jobs=invalid');
  }

  try {
    const job = await prisma.contentJob.findUnique({
      where: { id: jobId },
    });

    if (job) {
      if (actionType === 'CANCEL') {
        await prisma.contentJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: 'Cancelled by admin',
            completedAt: new Date(),
          },
        });
        await writeAdminAudit(session, 'JOB_CANCELLED', {
          jobId,
          previousStatus: job.status,
        });
      } else if (actionType === 'RETRY') {
        const retriedJob = await prisma.contentJob.create({
          data: {
            userId: job.userId,
            workspaceId: job.workspaceId,
            type: job.type,
            status: 'PENDING',
            inputPayload: job.inputPayload as Prisma.InputJsonValue,
            errorMessage: null,
            creditsCost: 0,
          },
        });
        await writeAdminAudit(session, 'JOB_RETRIED', {
          jobId,
          retriedJobId: retriedJob.id,
          previousStatus: job.status,
        });
      } else {
        redirect('/admin?section=jobs&jobs=invalid');
      }
      revalidatePath('/admin');
      redirect('/admin?section=jobs&jobs=saved');
      return; // Ensure we exit
    }

    const socialJob = await prisma.socialPublishJob.findUnique({
      where: { id: jobId },
    });

    if (socialJob) {
      const { getToken } = await auth();
      const token = await getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      if (actionType === 'CANCEL') {
        const res = await fetch(`${baseUrl}/api/v1/social/publish-jobs/${jobId}?workspaceId=${socialJob.workspaceId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Cancel failed with ${res.status}`);
        await writeAdminAudit(session, 'SOCIAL_JOB_CANCELLED', { jobId, previousStatus: socialJob.status });
      } else if (actionType === 'RETRY') {
        const res = await fetch(`${baseUrl}/api/v1/social/publish-jobs/${jobId}/retry?workspaceId=${socialJob.workspaceId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Retry failed with ${res.status}`);
        await writeAdminAudit(session, 'SOCIAL_JOB_RETRIED', { jobId, previousStatus: socialJob.status });
      } else {
        redirect('/admin?section=jobs&jobs=invalid');
      }

      revalidatePath('/admin');
      redirect('/admin?section=jobs&jobs=saved');
      return;
    }

    redirect('/admin?section=jobs&jobs=invalid');
  } catch (error) {
    console.error('Failed to manage job from admin:', error);
    redirect('/admin?section=jobs&jobs=failed');
  }
}

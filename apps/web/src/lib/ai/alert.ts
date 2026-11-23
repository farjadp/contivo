/**
 * Loud, never silent (spec §"Loud, never silent").
 *
 * Every failed attempt, every health change and every full outage becomes:
 *  - an ai_provider_events row (message sanitised, 500 chars),
 *  - a Sentry message tagged ai.provider / ai.task / ai.error_class,
 *    fingerprint [provider, errorClass] so one outage is one issue,
 *  - a console.error line.
 *
 * None of this may break the AI call: every write is caught and logged.
 */

import * as Sentry from '@sentry/nextjs';

import { sanitizeAiMessage } from './errors';
import { CRITICAL_CLASSES, type HealthTransition } from './health';
import type { AiAttempt, AiCallContext, AiErrorClass, AiTask, ProviderId } from './types';

/** Prefix on every row caused by AI_FORCE_FAIL; such rows are evidence only, never restored as health. */
export const FORCED_MARKER = '[AI_FORCE_FAIL]';

export type AiProviderEventType = 'attempt_failed' | 'health_changed' | 'all_unavailable';

export interface AiProviderEventRow {
  provider: string;
  task: string;
  errorClass: string;
  status: number | null;
  message: string | null;
  failedOverTo: string | null;
  eventType: AiProviderEventType;
  workspaceId: string | null;
  userId: string | null;
}

export interface CriticalEvent {
  provider: ProviderId;
  errorClass: AiErrorClass;
  createdAt: Date;
}

/** The DB side, behind an interface so tests (and a missing table) never break the layer. */
export interface AiProviderEventStore {
  insert(row: AiProviderEventRow): Promise<void>;
  /** Latest billing/auth/model_gone failure or recovery per provider since `since`. */
  latestCriticalSince(since: Date): Promise<Array<CriticalEvent | { provider: ProviderId; recovered: true; createdAt: Date }>>;
}

export interface AttemptFailedAlert {
  provider: ProviderId;
  task: AiTask;
  errorClass: AiErrorClass;
  status?: number;
  message: string;
  failedOverTo: ProviderId | null;
  forced: boolean;
  ctx: AiCallContext;
}

export interface AiAlertSink {
  attemptFailed(alert: AttemptFailedAlert): void;
  healthChanged(transition: HealthTransition, task: AiTask, ctx: AiCallContext, forced?: boolean): void;
  allUnavailable(task: AiTask, attempts: AiAttempt[], ctx: AiCallContext, firstErrorClass: string): void;
  notConfigured(provider: ProviderId, keyEnv: string): void;
}

type SentryLike = Pick<typeof Sentry, 'captureMessage'>;
type SentryLevel = 'fatal' | 'error' | 'warning';

function levelFor(errorClass: AiErrorClass): SentryLevel {
  if (CRITICAL_CLASSES.has(errorClass)) return 'fatal';
  if (errorClass === 'bad_request') return 'error';
  return 'warning';
}

export function createAlertSink(deps: {
  store: AiProviderEventStore | null;
  sentry?: SentryLike;
  log?: Pick<Console, 'error' | 'warn'>;
}): AiAlertSink {
  const sentry = deps.sentry ?? Sentry;
  const log = deps.log ?? console;
  const notConfiguredLogged = new Set<ProviderId>();

  const write = (row: AiProviderEventRow) => {
    if (!deps.store) return;
    try {
      deps.store.insert(row).catch((error: unknown) => {
        log.error('[ai] could not write ai_provider_events row:', sanitizeAiMessage((error as Error)?.message ?? error));
      });
    } catch (error) {
      log.error('[ai] could not write ai_provider_events row:', sanitizeAiMessage((error as Error)?.message ?? error));
    }
  };

  const capture = (
    message: string,
    level: SentryLevel,
    tags: Record<string, string>,
    fingerprint: string[],
    extra?: Record<string, unknown>,
  ) => {
    try {
      sentry.captureMessage(message, { level, tags, fingerprint, extra });
    } catch (error) {
      log.error('[ai] Sentry captureMessage failed:', sanitizeAiMessage((error as Error)?.message ?? error));
    }
  };

  return {
    attemptFailed(alert) {
      const message = sanitizeAiMessage(alert.forced ? `${FORCED_MARKER} ${alert.message}` : alert.message);
      try {
        log.error(
          `[ai] ${alert.provider} ${alert.errorClass} → ${alert.failedOverTo ?? 'none'} for ${alert.task}` +
            (alert.status ? ` (HTTP ${alert.status})` : '') +
            (alert.forced ? ' [forced by AI_FORCE_FAIL]' : ''),
        );
      } catch {
        // console itself failing is not worth breaking the call over
      }
      write({
        provider: alert.provider,
        task: alert.task,
        errorClass: alert.errorClass,
        status: alert.status ?? null,
        message,
        failedOverTo: alert.failedOverTo,
        eventType: 'attempt_failed',
        workspaceId: alert.ctx.workspaceId ?? null,
        userId: alert.ctx.userId ?? null,
      });
      capture(
        `AI provider ${alert.provider} failed: ${alert.errorClass}`,
        levelFor(alert.errorClass),
        { 'ai.provider': alert.provider, 'ai.task': alert.task, 'ai.error_class': alert.errorClass },
        [alert.provider, alert.errorClass],
        { status: alert.status, message, failedOverTo: alert.failedOverTo, forced: alert.forced },
      );
    },

    healthChanged(transition, task, ctx, forced = false) {
      const until = transition.coolingDownUntil ? new Date(transition.coolingDownUntil).toISOString() : null;
      try {
        log.error(
          transition.change === 'recovered'
            ? `[ai] ${transition.provider} recovered`
            : `[ai] ${transition.provider} unhealthy (${transition.change}) until ${until}`,
        );
      } catch {
        // ignore
      }
      write({
        provider: transition.provider,
        task,
        errorClass: transition.change,
        status: null,
        message: `${forced ? `${FORCED_MARKER} ` : ''}${until ? `cooling down until ${until}` : 'healthy again'}`,
        failedOverTo: null,
        eventType: 'health_changed',
        workspaceId: ctx.workspaceId ?? null,
        userId: ctx.userId ?? null,
      });
    },

    allUnavailable(task, attempts, ctx, firstErrorClass) {
      const summary = attempts.map((a) => `${a.provider}:${a.errorClass}`).join(', ') || 'no provider configured';
      try {
        log.error(`[ai] AI fully unavailable for ${task} (${summary})`);
      } catch {
        // ignore
      }
      write({
        provider: 'all',
        task,
        // The real cause (a cooling-down provider counts with its reason), not 'cooling_down'.
        errorClass: firstErrorClass,
        status: null,
        message: sanitizeAiMessage(summary),
        failedOverTo: null,
        eventType: 'all_unavailable',
        workspaceId: ctx.workspaceId ?? null,
        userId: ctx.userId ?? null,
      });
      capture(
        'AI fully unavailable',
        'fatal',
        { 'ai.provider': 'all', 'ai.task': task, 'ai.error_class': 'all_unavailable', 'ai.first_error_class': firstErrorClass },
        ['all', 'all_unavailable'],
        { attempts: summary },
      );
    },

    notConfigured(provider, keyEnv) {
      if (notConfiguredLogged.has(provider)) return;
      notConfiguredLogged.add(provider);
      try {
        log.warn(`[ai] ${provider} not configured (${keyEnv} unset) — skipped in every chain`);
      } catch {
        // ignore
      }
    },
  };
}

/** Prisma-backed store. Lazy import keeps Prisma out of unit tests. */
export function createPrismaEventStore(): AiProviderEventStore {
  const db = async () => (await import('@/lib/db')).prisma;
  return {
    async insert(row) {
      await (await db()).aiProviderEvent.create({ data: row });
    },
    async latestCriticalSince(since) {
      const rows = await (await db()).aiProviderEvent.findMany({
        where: {
          createdAt: { gte: since },
          provider: { in: ['openai', 'anthropic', 'gemini'] },
          OR: [
            { eventType: 'attempt_failed', errorClass: { in: ['billing', 'auth', 'model_gone'] } },
            { eventType: 'health_changed', errorClass: { in: ['billing', 'auth', 'model_gone', 'recovered'] } },
          ],
          // A forced (AI_FORCE_FAIL) failure must never come back as a real cool-down,
          // and an image model that is gone (task content_image, lib/ai/image.ts)
          // says nothing about OpenAI's text models.
          NOT: [{ message: { startsWith: FORCED_MARKER } }, { task: 'content_image' }],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { provider: true, errorClass: true, createdAt: true, message: true },
      });
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (row.message?.startsWith(FORCED_MARKER)) continue; // belt and braces with the where clause
        if (!latest.has(row.provider)) latest.set(row.provider, row);
      }
      return [...latest.values()].map((row) =>
        row.errorClass === 'recovered'
          ? { provider: row.provider as ProviderId, recovered: true as const, createdAt: row.createdAt }
          : { provider: row.provider as ProviderId, errorClass: row.errorClass as AiErrorClass, createdAt: row.createdAt },
      );
    },
  };
}

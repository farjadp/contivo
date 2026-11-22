/**
 * PublishHistorySection.tsx
 *
 * Shows the history of published and cancelled social posts for the workspace.
 * Read-only apart from viewing external post links and, on a job that failed
 * because of its account, Reconnect / Connect.
 *
 * Data is passed as props from the parent server component.
 */

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink, CheckCircle, XCircle, X } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { ActionErrorAlert } from '@/components/publishing/ActionErrorAlert';
import { FailureReason } from '@/components/publishing/FailureReason';
import { JobFixButton } from '@/components/publishing/JobFixButton';
import { jobFixAction, safePostUrl } from '@/lib/publish-outcome';
import type { SocialActionDetail } from '@/lib/social-action-error';
import { startReconnect } from '@/lib/start-reconnect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishJob {
  id: string;
  platform: string;
  status: string;
  scheduledAtUtc: string | null;
  externalPostUrl: string | null;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  publishedAtUtc: string | null;
  socialConnectionId: string | null;
  connectionStatus: string | null;
}

interface PublishHistorySectionProps {
  jobs: PublishJob[];
  workspaceId: string;
  /** Opens the Connected accounts tab (a reconnect that cannot start from the row). */
  onOpenAccounts: () => void;
  /** Opens the Connect modal (no account behind the job). */
  onConnectNew: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn', X: 'X', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishHistorySection({ jobs, workspaceId, onOpenAccounts, onConnectNew }: PublishHistorySectionProps) {
  const t = useTranslations('connections.history');
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, SocialActionDetail>>({});

  /** Leaves the spinner on when it navigates to the provider sign-in. */
  const handleReconnect = async (jobId: string, connectionId: string) => {
    setPending(jobId);
    setErrors(({ [jobId]: _cleared, ...rest }) => rest);
    const detail = await startReconnect(connectionId, workspaceId);
    if (detail) {
      setErrors((prev) => ({ ...prev, [jobId]: detail }));
      setPending(null);
      router.refresh();
    }
  };

  // Show only terminal-state jobs
  const historyJobs = jobs
    .filter((j) => ['PUBLISHED', 'FAILED', 'CANCELLED'].includes(j.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-moss">{t('title')}</h3>
        <p className="text-xs text-moss-muted mt-0.5">{t('subtitle')}</p>
      </div>

      {historyJobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-rule p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-sm font-semibold text-moss">{t('emptyTitle')}</p>
          <p className="text-xs text-moss-muted mt-1">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {historyJobs.map((job) => {
            const isPublished = job.status === 'PUBLISHED';
            const isCancelled = job.status === 'CANCELLED';
            const isFailed = !isPublished && !isCancelled;
            const postUrl = isPublished ? safePostUrl(job.externalPostUrl) : null;
            const fix = jobFixAction(job);
            const error = errors[job.id];

            return (
              <div
                key={job.id}
                className="rounded-2xl border border-rule bg-chalk-raised p-4 shadow-sm"
              >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: platform + time */}
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isPublished ? 'bg-green-50' : isCancelled ? 'bg-chalk-sunk' : 'bg-red-50'
                  }`}>
                    {isPublished ? (
                      <CheckCircle className="w-4.5 h-4.5 text-green-500" />
                    ) : isCancelled ? (
                      <X className="w-4.5 h-4.5 text-moss-muted" />
                    ) : (
                      <XCircle className="w-4.5 h-4.5 text-red-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-moss">
                      {PLATFORM_LABELS[job.platform] ?? job.platform}
                    </p>
                    <p className="text-xs text-moss-muted">
                      {/* Formatted through next-intl so the Persian side gets the
                          Persian calendar, Persian digits and Tehran time. */}
                      {isPublished && job.publishedAtUtc
                        ? t('publishedAt', {
                            date: format.dateTime(new Date(job.publishedAtUtc), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
                          })
                        : t('createdAt', {
                            date: format.dateTime(new Date(job.createdAt), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
                          })}
                    </p>
                  </div>
                </div>

                {/* Right: status + link */}
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                    isPublished
                      ? 'text-green-600 bg-green-50'
                      : isCancelled
                      ? 'text-moss-muted bg-chalk-sunk'
                      : 'text-red-600 bg-red-50'
                  }`}>
                    {isPublished
                      ? t('status.published')
                      : isCancelled
                        ? t('status.cancelled')
                        : t('status.failed')}
                  </span>

                  {job.retryCount > 0 && (
                    <span className="text-xs text-orange-500 font-semibold bg-orange-50 rounded-full px-2 py-0.5">
                      {t('retries', { count: job.retryCount })}
                    </span>
                  )}

                  {postUrl && (
                    <a
                      href={postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-moss-700 hover:underline"
                    >
                      {/* The glyph's arrow leaves the box toward the reading
                          edge, so it mirrors with the layout. */}
                      <ExternalLink className="w-3.5 h-3.5 rtl:-scale-x-100" />
                      {t('viewPost')}
                    </a>
                  )}

                  {fix && (
                    <JobFixButton
                      fix={fix}
                      pending={pending === job.id}
                      labels={{ reconnect: t('reconnect'), connect: t('connect') }}
                      onReconnect={(connectionId) => void handleReconnect(job.id, connectionId)}
                      onOpenAccounts={onOpenAccounts}
                      onConnectNew={onConnectNew}
                    />
                  )}
                </div>
              </div>

              {/* The full reason: it is the only thing that tells the user what to fix. */}
              {isFailed && (
                <FailureReason reason={job.lastError} label={t('failureReason')} className="mt-3 text-red-700" />
              )}
              {error && <ActionErrorAlert className="mt-3" headline={t('errors.reconnect')} detail={error} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

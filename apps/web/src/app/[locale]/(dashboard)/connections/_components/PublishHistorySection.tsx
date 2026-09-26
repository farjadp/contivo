/**
 * PublishHistorySection.tsx
 *
 * Shows the history of published and cancelled social posts for the workspace.
 * Read-only — no actions except viewing external post links.
 *
 * Data is passed as props from the parent server component.
 */

'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink, CheckCircle, XCircle, X } from 'lucide-react';

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
}

interface PublishHistorySectionProps {
  jobs: PublishJob[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn', X: 'X', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishHistorySection({ jobs }: PublishHistorySectionProps) {
  const t = useTranslations('connections.history');
  const format = useFormatter();

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

            return (
              <div
                key={job.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rule bg-chalk-raised p-4 shadow-sm"
              >
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

                  {isPublished && job.externalPostUrl && (
                    <a
                      href={job.externalPostUrl}
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

                  {!isPublished && !isCancelled && job.lastError && (
                    <span
                      className="text-xs text-red-400 max-w-[200px] truncate"
                      title={job.lastError}
                    >
                      {job.lastError}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

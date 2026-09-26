/**
 * PublishQueueSection.tsx
 *
 * Shows scheduled and pending publish jobs for the workspace.
 * Allows retrying failed jobs and cancelling queued ones.
 *
 * Data is passed as props from the parent server component.
 */

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { RotateCcw, X, Clock, Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { retryPublishJob, cancelPublishJob } from '@/app/actions/social';

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

interface PublishQueueSectionProps {
  jobs: PublishJob[];
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** `key` indexes into `connections.queue.status.*` — the label itself is copy. */
const STATUS_CONFIG: Record<string, { key: string; className: string; Icon: React.ElementType }> = {
  DRAFT:          { key: 'draft',      className: 'text-moss-muted bg-chalk-sunk',    Icon: Clock },
  READY:          { key: 'ready',      className: 'text-blue-600 bg-blue-50',     Icon: Zap },
  SCHEDULED:      { key: 'scheduled',  className: 'text-moss-700 bg-chalk-sunk', Icon: Clock },
  PUBLISH_QUEUED: { key: 'queued',     className: 'text-purple-600 bg-purple-50', Icon: Zap },
  PUBLISHING:     { key: 'publishing', className: 'text-yellow-600 bg-yellow-50', Icon: Loader2 },
  PUBLISHED:      { key: 'published',  className: 'text-green-600 bg-green-50',   Icon: CheckCircle },
  FAILED:         { key: 'failed',     className: 'text-red-600 bg-red-50',        Icon: XCircle },
  CANCELLED:      { key: 'cancelled',  className: 'text-moss-muted bg-chalk-sunk',    Icon: X },
};

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn', X: 'X', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishQueueSection({ jobs, workspaceId }: PublishQueueSectionProps) {
  const t = useTranslations('connections.queue');
  const format = useFormatter();
  const [loading, setLoading] = useState<string | null>(null);

  // Show active jobs (not published / cancelled / revoked)
  const activeJobs = jobs.filter(
    (j) => !['PUBLISHED', 'CANCELLED'].includes(j.status),
  );

  const handleRetry = async (id: string) => {
    setLoading(`retry-${id}`);
    await retryPublishJob(id, workspaceId);
    setLoading(null);
  };

  const handleCancel = async (id: string) => {
    if (!confirm(t('cancelConfirm'))) return;
    setLoading(`cancel-${id}`);
    await cancelPublishJob(id, workspaceId);
    setLoading(null);
  };

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-moss">{t('title')}</h3>
        <p className="text-xs text-moss-muted mt-0.5">{t('subtitle')}</p>
      </div>

      {activeJobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-rule p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-chalk-sunk flex items-center justify-center mx-auto mb-3">
            <Clock className="w-5 h-5 text-moss-700" />
          </div>
          <p className="text-sm font-semibold text-moss">{t('emptyTitle')}</p>
          <p className="text-xs text-moss-muted mt-1">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-start text-xs font-semibold text-moss-muted uppercase tracking-wide">
                <th className="pb-3 pe-4 text-start">{t('columnPlatform')}</th>
                <th className="pb-3 pe-4 text-start">{t('columnScheduled')}</th>
                <th className="pb-3 pe-4 text-start">{t('columnStatus')}</th>
                <th className="pb-3 pe-4 text-start">{t('columnRetries')}</th>
                <th className="pb-3 text-start">{t('columnActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {activeJobs.map((job) => {
                const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.DRAFT;
                const StatusIcon = config.Icon;
                const isJobLoading = loading?.endsWith(job.id);

                return (
                  <tr key={job.id} className="hover:bg-chalk/50 transition-colors">
                    <td className="py-3 pe-4 font-semibold text-moss">
                      {PLATFORM_LABELS[job.platform] ?? job.platform}
                    </td>
                    <td className="py-3 pe-4 text-moss-muted text-xs">
                      {/* Formatted through next-intl so the Persian side gets the
                          Persian calendar, Persian digits and Tehran time. */}
                      {job.scheduledAtUtc
                        ? format.dateTime(new Date(job.scheduledAtUtc), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : t('immediate')}
                    </td>
                    <td className="py-3 pe-4">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 ${config.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {t(`status.${config.key}`)}
                      </span>
                    </td>
                    <td className="py-3 pe-4 text-moss-muted text-xs">
                      {job.retryCount > 0 ? (
                        <span className="text-orange-500 font-semibold">
                          ×{format.number(job.retryCount)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {job.status === 'FAILED' && (
                          <button
                            onClick={() => handleRetry(job.id)}
                            disabled={isJobLoading}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-moss-700 hover:underline disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {t('retry')}
                          </button>
                        )}
                        {!['PUBLISHING', 'PUBLISHED'].includes(job.status) && (
                          <button
                            onClick={() => handleCancel(job.id)}
                            disabled={isJobLoading}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                            {t('cancel')}
                          </button>
                        )}
                      </div>
                      {job.lastError && (
                        <p className="text-[10px] text-red-500 mt-1 max-w-[200px] truncate" title={job.lastError}>
                          {job.lastError}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

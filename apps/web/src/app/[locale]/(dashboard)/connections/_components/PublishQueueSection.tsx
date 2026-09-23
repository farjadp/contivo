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

const STATUS_CONFIG: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  DRAFT:          { label: 'Draft',         className: 'text-gray-500 bg-gray-100',    Icon: Clock },
  READY:          { label: 'Ready',         className: 'text-blue-600 bg-blue-50',     Icon: Zap },
  SCHEDULED:      { label: 'Scheduled',     className: 'text-indigo-600 bg-indigo-50', Icon: Clock },
  PUBLISH_QUEUED: { label: 'Queued',        className: 'text-purple-600 bg-purple-50', Icon: Zap },
  PUBLISHING:     { label: 'Publishing…',   className: 'text-yellow-600 bg-yellow-50', Icon: Loader2 },
  PUBLISHED:      { label: 'Published',     className: 'text-green-600 bg-green-50',   Icon: CheckCircle },
  FAILED:         { label: 'Failed',        className: 'text-red-600 bg-red-50',        Icon: XCircle },
  CANCELLED:      { label: 'Cancelled',     className: 'text-gray-400 bg-gray-100',    Icon: X },
};

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn', X: 'X', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishQueueSection({ jobs, workspaceId }: PublishQueueSectionProps) {
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
    if (!confirm('Cancel this publish job?')) return;
    setLoading(`cancel-${id}`);
    await cancelPublishJob(id, workspaceId);
    setLoading(null);
  };

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-[#121212]">Publish Queue</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Scheduled and in-progress posts. Published and cancelled jobs appear in History.
        </p>
      </div>

      {activeJobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <Clock className="w-5 h-5 text-[#2B2DFF]" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No active jobs</p>
          <p className="text-xs text-gray-400 mt-1">
            When you schedule content to publish, it will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="pb-3 pr-4">Platform</th>
                <th className="pb-3 pr-4">Scheduled</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Retries</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activeJobs.map((job) => {
                const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.DRAFT;
                const StatusIcon = config.Icon;
                const isJobLoading = loading?.endsWith(job.id);

                return (
                  <tr key={job.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 pr-4 font-semibold text-[#121212]">
                      {PLATFORM_LABELS[job.platform] ?? job.platform}
                    </td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">
                      {job.scheduledAtUtc
                        ? new Date(job.scheduledAtUtc).toLocaleString()
                        : 'Immediate'}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 ${config.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {config.label}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">
                      {job.retryCount > 0 ? (
                        <span className="text-orange-500 font-semibold">×{job.retryCount}</span>
                      ) : '—'}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {job.status === 'FAILED' && (
                          <button
                            onClick={() => handleRetry(job.id)}
                            disabled={isJobLoading}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2B2DFF] hover:underline disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Retry
                          </button>
                        )}
                        {!['PUBLISHING', 'PUBLISHED'].includes(job.status) && (
                          <button
                            onClick={() => handleCancel(job.id)}
                            disabled={isJobLoading}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                            Cancel
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

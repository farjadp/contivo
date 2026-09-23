/**
 * PublishHistorySection.tsx
 *
 * Shows the history of published and cancelled social posts for the workspace.
 * Read-only — no actions except viewing external post links.
 *
 * Data is passed as props from the parent server component.
 */

'use client';

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
  // Show only terminal-state jobs
  const historyJobs = jobs
    .filter((j) => ['PUBLISHED', 'FAILED', 'CANCELLED'].includes(j.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-[#121212]">Publish History</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          All completed publish attempts — published, failed, or cancelled.
        </p>
      </div>

      {historyJobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No history yet</p>
          <p className="text-xs text-gray-400 mt-1">Published and failed posts will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {historyJobs.map((job) => {
            const isPublished = job.status === 'PUBLISHED';
            const isCancelled = job.status === 'CANCELLED';

            return (
              <div
                key={job.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                {/* Left: platform + time */}
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isPublished ? 'bg-green-50' : isCancelled ? 'bg-gray-100' : 'bg-red-50'
                  }`}>
                    {isPublished ? (
                      <CheckCircle className="w-4.5 h-4.5 text-green-500" />
                    ) : isCancelled ? (
                      <X className="w-4.5 h-4.5 text-gray-400" />
                    ) : (
                      <XCircle className="w-4.5 h-4.5 text-red-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#121212]">
                      {PLATFORM_LABELS[job.platform] ?? job.platform}
                    </p>
                    <p className="text-xs text-gray-400">
                      {isPublished && job.publishedAtUtc
                        ? `Published ${new Date(job.publishedAtUtc).toLocaleString()}`
                        : `Created ${new Date(job.createdAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>

                {/* Right: status + link */}
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                    isPublished
                      ? 'text-green-600 bg-green-50'
                      : isCancelled
                      ? 'text-gray-400 bg-gray-100'
                      : 'text-red-600 bg-red-50'
                  }`}>
                    {isPublished ? 'Published' : isCancelled ? 'Cancelled' : 'Failed'}
                  </span>

                  {job.retryCount > 0 && (
                    <span className="text-xs text-orange-500 font-semibold bg-orange-50 rounded-full px-2 py-0.5">
                      {job.retryCount} retries
                    </span>
                  )}

                  {isPublished && job.externalPostUrl && (
                    <a
                      href={job.externalPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2B2DFF] hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View post
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

import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth';
import { listUserActivityLogs } from '@/lib/activity-log';
import { updatePlatformLimits } from '@/app/actions/admin';
import {
  PLATFORM_LIMIT_MAX,
  PLATFORM_LIMIT_MIN,
  getBrandMemoryRescrapeLimit,
  getCompetitiveLandscapeLimit,
  getContentWordCountLimits,
  getIdeationMaxContentCount,
} from '@/lib/app-settings';
import { WORD_COUNT_LIMIT_ABSOLUTE_MAX, WORD_COUNT_LIMIT_ABSOLUTE_MIN, WORD_COUNT_PLATFORM_LABELS, WORD_COUNT_PLATFORMS } from '@/lib/content-word-count';

export const metadata = { title: 'Settings' };

function prettyAction(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const resolvedSearchParams = await searchParams;
  const limitsStatus = resolvedSearchParams.limits as string | undefined;

  const [logs, competitiveLimit, brandMemoryLimit, ideationMaxContentCount, wordCountLimits] = await Promise.all([
    listUserActivityLogs(session.userId as string, 120),
    getCompetitiveLandscapeLimit(),
    getBrandMemoryRescrapeLimit(),
    getIdeationMaxContentCount(),
    getContentWordCountLimits(),
  ]);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#121212]">Settings</h1>
        <p className="text-gray-500 mt-2 text-sm">
          Account preferences and activity logs for your workspace operations.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">Workspace Limits</h2>
        {limitsStatus === 'saved' ? (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            Limits updated successfully.
          </div>
        ) : null}
        {limitsStatus === 'invalid' ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Invalid limit value. Use an integer between {PLATFORM_LIMIT_MIN} and {PLATFORM_LIMIT_MAX}.
          </div>
        ) : null}
        {limitsStatus === 'failed' ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not save limits. Check database connection and retry.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              Competitive Landscape
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {competitiveLimit} AI discovery runs per workspace
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              Brand Memory
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {brandMemoryLimit} rescrape attempts per workspace
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              Ideation
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {ideationMaxContentCount} max ideas per generation
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">
            Content Word Count Limits (Per Platform)
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WORD_COUNT_PLATFORMS.map((platform) => (
              <div key={platform} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-600">
                  {WORD_COUNT_PLATFORM_LABELS[platform]}
                </p>
                <p className="mt-1 text-sm font-medium text-[#121212]">
                  {wordCountLimits[platform].min} - {wordCountLimits[platform].max} words
                </p>
              </div>
            ))}
          </div>
        </div>

        {session.role === 'ADMIN' ? (
          <form action={updatePlatformLimits} className="mt-5 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="redirectTo" value="/settings" />
            <label className="space-y-2">
              <span className="block text-xs uppercase tracking-widest text-gray-500 font-semibold">
                Competitive Landscape Limit
              </span>
              <input
                type="number"
                name="competitiveLandscapeLimit"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={competitiveLimit}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-xs uppercase tracking-widest text-gray-500 font-semibold">
                Brand Memory Limit
              </span>
              <input
                type="number"
                name="brandMemoryLimit"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={brandMemoryLimit}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-xs uppercase tracking-widest text-gray-500 font-semibold">
                Ideation Max Content Count
              </span>
              <input
                type="number"
                name="ideationMaxContentCount"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={ideationMaxContentCount}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
            </label>
            <div className="md:col-span-3">
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-[#121212]">Word Count Limits</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {WORD_COUNT_PLATFORMS.map((platform) => (
                    <div key={platform} className="rounded-md border border-gray-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
                        {WORD_COUNT_PLATFORM_LABELS[platform]}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-gray-500">Min</span>
                          <input
                            type="number"
                            name={`wordMin_${platform}`}
                            min={WORD_COUNT_LIMIT_ABSOLUTE_MIN}
                            max={WORD_COUNT_LIMIT_ABSOLUTE_MAX}
                            defaultValue={wordCountLimits[platform].min}
                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-black focus:outline-none"
                            required
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-gray-500">Max</span>
                          <input
                            type="number"
                            name={`wordMax_${platform}`}
                            min={WORD_COUNT_LIMIT_ABSOLUTE_MIN}
                            max={WORD_COUNT_LIMIT_ABSOLUTE_MAX}
                            defaultValue={wordCountLimits[platform].max}
                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-black focus:outline-none"
                            required
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-[#1f1f1f]"
              >
                Save Limits
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">Account</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">Email</p>
            <p className="text-sm font-medium text-[#121212]">{session.email}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">Role</p>
            <p className="text-sm font-medium text-[#121212]">{session.role}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">Activity Logs</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">No activity logs yet.</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-[#121212]">{prettyAction(log.action)}</p>
                    <p className="text-xs text-gray-500">
                      {log.workspaceName ? `Workspace: ${log.workspaceName}` : 'Workspace: n/a'}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
                {log.detail ? (
                  <pre className="mt-3 overflow-x-auto rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    {JSON.stringify(log.detail, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

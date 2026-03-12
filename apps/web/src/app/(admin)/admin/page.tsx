import { getSession } from '@/lib/auth';
import { updateGeminiModel, updatePlatformLimits } from '@/app/actions/admin';
import {
  GEMINI_MODEL_PRESETS,
  PLATFORM_LIMIT_MAX,
  PLATFORM_LIMIT_MIN,
  getBrandMemoryRescrapeLimit,
  getCompetitiveLandscapeLimit,
  getContentWordCountLimits,
  getGeminiModel,
  getIdeationMaxContentCount,
} from '@/lib/app-settings';
import { WORD_COUNT_LIMIT_ABSOLUTE_MAX, WORD_COUNT_LIMIT_ABSOLUTE_MIN, WORD_COUNT_PLATFORM_LABELS, WORD_COUNT_PLATFORMS } from '@/lib/content-word-count';
import {
  getFrameworkUsageSummary,
  listRecentFrameworkMetadata,
} from '@/lib/framework-metadata-log';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function AdminDashboardPage({ searchParams }: Props) {
  const user = await getSession();
  const resolvedParams = await searchParams;
  const settingsStatus = resolvedParams.settings as string | undefined;
  const limitsStatus = resolvedParams.limits as string | undefined;

  const [currentGeminiModel, currentCompetitiveLimit, currentBrandMemoryLimit, currentIdeationMaxContentCount, currentWordCountLimits, frameworkSummary, recentFrameworkRuns] = await Promise.all([
    getGeminiModel(),
    getCompetitiveLandscapeLimit(),
    getBrandMemoryRescrapeLimit(),
    getIdeationMaxContentCount(),
    getContentWordCountLimits(),
    getFrameworkUsageSummary(30),
    listRecentFrameworkMetadata(60),
  ]);
  const envGeminiModel = process.env.GEMINI_MODEL?.trim();
  const totalFrameworkEvents = frameworkSummary.reduce((acc, row) => acc + row.events, 0);
  const totalFallbackEvents = frameworkSummary.reduce((acc, row) => acc + row.fallbackEvents, 0);
  const weightedAvgQuality =
    frameworkSummary.length > 0
      ? frameworkSummary.reduce((acc, row) => acc + (row.avgOverallScore || 0) * row.events, 0) /
        Math.max(1, totalFrameworkEvents)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#121212]">Admin Dashboard</h1>
        <p className="text-gray-500 mt-2">
          Welcome back, {user?.email ?? 'Admin'}. Here is your platform overview.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Framework Events (30d)</h3>
          <p className="text-4xl font-bold mt-2 text-[#121212]">{totalFrameworkEvents.toLocaleString()}</p>
          <span className="text-gray-500 text-sm font-medium mt-2 block">Real tracked metadata rows</span>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Fallback Usage (30d)</h3>
          <p className="text-4xl font-bold mt-2 text-[#121212]">{totalFallbackEvents.toLocaleString()}</p>
          <span className="text-gray-500 text-sm font-medium mt-2 block">Auto fallback applications</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Avg Framework Score (30d)</h3>
          <p className="text-4xl font-bold mt-2 text-[#121212]">{weightedAvgQuality.toFixed(2)}</p>
          <span className="text-gray-500 text-sm font-medium mt-2 block">Weighted by event volume</span>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-[#121212]">Framework Engine Reporting</h2>
          <p className="text-sm text-gray-500 mt-2">
            Real framework metadata from ideation, pipeline save, and draft generation.
          </p>
        </div>

        <div className="p-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-[#121212]">Framework Summary (Last 30 Days)</h3>
            </div>
            {frameworkSummary.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No framework metadata yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {frameworkSummary.map((row) => (
                  <div key={row.frameworkId} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#121212]">{row.frameworkName}</p>
                      <p className="text-xs text-gray-500">{row.frameworkId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#121212]">{row.events.toLocaleString()} events</p>
                      <p className="text-xs text-gray-500">
                        fallback: {row.fallbackEvents.toLocaleString()} • avg score:{' '}
                        {(row.avgOverallScore || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-[#121212]">Recent Framework Events</h3>
            </div>
            {recentFrameworkRuns.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No recent events.</div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[420px] overflow-auto">
                {recentFrameworkRuns.slice(0, 30).map((entry) => (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[#121212]">{entry.frameworkName}</p>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">
                      {entry.eventName} • {entry.workspaceName || entry.workspaceId} • mode={entry.selectionMode}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {entry.userEmail || entry.userId}
                      {entry.fallbackUsed ? ' • fallback=yes' : ''}
                      {entry.qualityScores?.overall_score
                        ? ` • score=${Number(entry.qualityScores.overall_score).toFixed(2)}`
                        : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-[#121212]">Platform Limits</h2>
          <p className="text-sm text-gray-500 mt-2">
            Configure manual limits for Competitive Landscape and Brand Memory.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {limitsStatus === 'saved' ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Limits updated successfully.
            </div>
          ) : null}
          {limitsStatus === 'invalid' ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Invalid limit value. Use an integer between {PLATFORM_LIMIT_MIN} and {PLATFORM_LIMIT_MAX}.
            </div>
          ) : null}
          {limitsStatus === 'failed' ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Could not save limits. Check database connection and retry.
            </div>
          ) : null}

          <form action={updatePlatformLimits} className="grid gap-5 md:grid-cols-2">
            <input type="hidden" name="redirectTo" value="/admin" />
            <label className="space-y-2">
              <span className="block text-sm font-medium text-[#121212]">
                Competitive Landscape Limit
              </span>
              <input
                type="number"
                name="competitiveLandscapeLimit"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={currentCompetitiveLimit}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
              <span className="text-xs text-gray-500">
                Max AI discovery runs per workspace.
              </span>
            </label>

            <label className="space-y-2">
              <span className="block text-sm font-medium text-[#121212]">
                Brand Memory Rescrape Limit
              </span>
              <input
                type="number"
                name="brandMemoryLimit"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={currentBrandMemoryLimit}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
              <span className="text-xs text-gray-500">
                Max website rescrape attempts per workspace.
              </span>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="block text-sm font-medium text-[#121212]">
                Ideation Max Content Count
              </span>
              <input
                type="number"
                name="ideationMaxContentCount"
                min={PLATFORM_LIMIT_MIN}
                max={PLATFORM_LIMIT_MAX}
                defaultValue={currentIdeationMaxContentCount}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                required
              />
              <span className="text-xs text-gray-500">
                Max number of ideas per generation request.
              </span>
            </label>

            <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-semibold text-[#121212]">Content Word Count Limits (Per Platform)</p>
              <p className="mt-1 text-xs text-gray-500">
                Configure minimum and maximum words for content generation by platform.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                          defaultValue={currentWordCountLimits[platform].min}
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
                          defaultValue={currentWordCountLimits[platform].max}
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-black focus:outline-none"
                          required
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 flex items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-[#1f1f1f]"
              >
                Save Limits
              </button>
              <span className="text-xs text-gray-500">
                Range: {PLATFORM_LIMIT_MIN} to {PLATFORM_LIMIT_MAX}
              </span>
              <span className="text-xs text-gray-500">
                Word range: {WORD_COUNT_LIMIT_ABSOLUTE_MIN} to {WORD_COUNT_LIMIT_ABSOLUTE_MAX}
              </span>
            </div>
          </form>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-[#121212]">AI Model Control</h2>
          <p className="text-sm text-gray-500 mt-2">
            Change the active Gemini model directly from admin.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {settingsStatus === 'saved' ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Gemini model updated successfully.
            </div>
          ) : null}
          {settingsStatus === 'empty' ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Model name is required.
            </div>
          ) : null}
          {settingsStatus === 'invalid' ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Invalid model name. Use letters, numbers, dots, underscores, and hyphens only.
            </div>
          ) : null}
          {settingsStatus === 'failed' ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Could not save model setting. Check database connection and retry.
            </div>
          ) : null}

          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <span className="font-medium text-[#121212]">Current active model:</span>{' '}
            <code>{currentGeminiModel}</code>
            {envGeminiModel ? (
              <p className="mt-2 text-xs text-amber-700">
                `GEMINI_MODEL` is set in environment to <code>{envGeminiModel}</code>. This override takes priority over admin settings.
              </p>
            ) : null}
          </div>

          <form action={updateGeminiModel} className="space-y-3">
            <label htmlFor="geminiModel" className="block text-sm font-medium text-[#121212]">
              Gemini model ID
            </label>
            <input
              id="geminiModel"
              name="geminiModel"
              defaultValue={currentGeminiModel}
              list="gemini-model-presets"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              placeholder="gemini-3-pro-preview"
              required
            />
            <datalist id="gemini-model-presets">
              {GEMINI_MODEL_PRESETS.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-[#1f1f1f]"
              >
                Save Model
              </button>
              <span className="text-xs text-gray-500">Recommended: <code>gemini-3-pro-preview</code></span>
            </div>
          </form>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-[#121212]">Recent System Events</h2>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="p-4 flex justify-between items-center bg-gray-50/50">
            <div>
              <p className="text-sm font-medium text-[#121212]">User dev@contivo.app generated Instant Content</p>
              <p className="text-xs text-gray-500 mt-1">Cost: 5 credits | Channel: LinkedIn</p>
            </div>
            <span className="text-xs text-gray-400">2 minutes ago</span>
          </div>
          <div className="p-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-[#121212]">New User Registration</p>
              <p className="text-xs text-gray-500 mt-1">sarah@marketing-pro.com</p>
            </div>
            <span className="text-xs text-gray-400">1 hour ago</span>
          </div>
          <div className="p-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-[#121212]">Credit Top Up: dev@contivo.app</p>
              <p className="text-xs text-gray-500 mt-1">Amount: +1000 credits</p>
            </div>
            <span className="text-xs text-gray-400">3 hours ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { redirect } from '@/i18n/navigation';

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
import { WORD_COUNT_LIMIT_ABSOLUTE_MAX, WORD_COUNT_LIMIT_ABSOLUTE_MIN, WORD_COUNT_PLATFORMS } from '@/lib/content-word-count';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: t('meta.title') };
}

/**
 * The fallback for an audit action this build has no wording for.
 *
 * Every known code has a translated label; new codes get added to the
 * catalogue as they are added to the codebase. Until then this renders the
 * code as readable English rather than hiding the event or printing the raw
 * SCREAMING_SNAKE — an audit log that drops entries it does not recognise is
 * worse than one with an untranslated line in it.
 */
function prettyAction(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const t = await getTranslations('settings');
  const format = await getFormatter();
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });
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
        <h1 className="text-3xl font-bold tracking-tight text-[#121212]">{t('title')}</h1>
        <p className="text-gray-500 mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">{t('limits.title')}</h2>
        {limitsStatus === 'saved' ? (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {t('limits.saved')}
          </div>
        ) : null}
        {limitsStatus === 'invalid' ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {t('limits.invalid', { min: PLATFORM_LIMIT_MIN, max: PLATFORM_LIMIT_MAX })}
          </div>
        ) : null}
        {limitsStatus === 'failed' ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {t('limits.failed')}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              {t('limits.competitiveLabel')}
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {t('limits.competitiveValue', { count: competitiveLimit })}
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              {t('limits.brandLabel')}
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {t('limits.brandValue', { count: brandMemoryLimit })}
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
              {t('limits.ideationLabel')}
            </p>
            <p className="text-sm font-medium text-[#121212]">
              {t('limits.ideationValue', { count: ideationMaxContentCount })}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">
            {t('limits.wordCountTitle')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WORD_COUNT_PLATFORMS.map((platform) => (
              <div key={platform} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-600">
                  {t(`platforms.${platform}`)}
                </p>
                <p className="mt-1 text-sm font-medium text-[#121212]">
                  {t('limits.wordCountRange', {
                    min: wordCountLimits[platform].min,
                    max: wordCountLimits[platform].max,
                  })}
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
                {t('limits.competitiveField')}
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
                {t('limits.brandField')}
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
                {t('limits.ideationField')}
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
                <p className="text-sm font-semibold text-[#121212]">{t('limits.wordCountField')}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {WORD_COUNT_PLATFORMS.map((platform) => (
                    <div key={platform} className="rounded-md border border-gray-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
                        {t(`platforms.${platform}`)}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-gray-500">{t('limits.min')}</span>
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
                          <span className="block text-[11px] font-medium text-gray-500">{t('limits.max')}</span>
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
                {t('limits.save')}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">{t('account.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('account.email')}</p>
            <p className="text-sm font-medium text-[#121212]">{session.email}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('account.role')}</p>
            <p className="text-sm font-medium text-[#121212]">{session.role}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#121212] mb-4">{t('activity.title')}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">{t('activity.empty')}</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-[#121212]">
                      {t.has(`actions.${log.action}`)
                        ? t(`actions.${log.action}`)
                        : prettyAction(log.action)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {log.workspaceName
                        ? t('activity.workspace', { name: log.workspaceName })
                        : t('activity.workspaceNone')}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {format.dateTime(new Date(log.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
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

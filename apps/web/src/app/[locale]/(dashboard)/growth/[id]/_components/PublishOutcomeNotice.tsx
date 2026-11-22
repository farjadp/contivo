'use client';

/**
 * PublishOutcomeNotice.tsx
 *
 * Tells the user, on the Pipeline card itself, what happened when a post was
 * published: a link to the live post, or the reason it failed and the one
 * thing to do about it. Before this, the post link only existed in
 * Connections > History and the failure reason only in the admin console.
 */

import { CheckCircle, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { FailureReason } from '@/components/publishing/FailureReason';
import { Link } from '@/i18n/navigation';
import type { PublishOutcome } from '@/lib/publish-outcome';

/** Network names stay Latin in both locales. */
const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn',
  X: 'X',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  TELEGRAM: 'Telegram',
  THREADS: 'Threads',
};

const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

export function PublishOutcomeNotice({
  outcome,
  workspaceId,
}: {
  outcome: PublishOutcome;
  workspaceId: string;
}) {
  const t = useTranslations('tabsA.pipeline.outcome');
  const format = useFormatter();
  const platform = outcome.platform ? PLATFORM_LABELS[outcome.platform] ?? outcome.platform : null;

  if (outcome.kind === 'published') {
    const date = outcome.publishedAtUtc
      ? format.dateTime(new Date(outcome.publishedAtUtc), { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    return (
      <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800">
        <p className="inline-flex items-center gap-1.5 font-bold">
          <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {/* One span, so the flex gap does not open up around the <bdi>. */}
          <span>{platform ? t.rich('publishedOn', { platform, bdi }) : t('published')}</span>
        </p>
        {date ? <p className="mt-1 text-green-700">{date}</p> : null}
        {outcome.url ? (
          <a
            href={outcome.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-semibold text-moss-700 hover:underline"
          >
            {/* The arrow leaves the box toward the reading edge, so it mirrors. */}
            <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            {t('viewPost')}
          </a>
        ) : platform ? (
          <p className="mt-1 text-green-700">{t('noLink')}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <p className="inline-flex items-center gap-1.5 font-bold">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{platform ? t.rich('failedOn', { platform, bdi }) : t('failed')}</span>
      </p>
      {outcome.code || outcome.detail ? (
        <FailureReason
          reason={{ code: outcome.code, detail: outcome.detail }}
          label={t('reasonLabel')}
          className="mt-1 text-red-700"
        />
      ) : (
        <p className="mt-1 text-red-700">
          <span className="font-semibold">{t('reasonLabel')}</span> {t('noReason')}
        </p>
      )}
      {outcome.action ? (
        <Link
          href={{ pathname: '/connections', query: { tab: outcome.action.tab, workspaceId } }}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-moss px-3 py-1.5 font-semibold text-chalk hover:bg-moss-700"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {outcome.action.action === 'reconnect' ? t('reconnect') : t('connect')}
        </Link>
      ) : null}
    </div>
  );
}

'use client';

/**
 * PublishedCard.tsx
 *
 * The end of the first-post path (spec first-post B §4.5): the post is live,
 * the link to it (only through safePostUrl), when it went out, and the one
 * line that the rest of the workspace is open, with its tools listed once.
 */

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import type { FirstPostState } from '@/lib/first-post/types';

import { eyebrow } from './DraftCard';
import { quietLink } from './PublishPanel';
import { publishedLink } from './first-post-view-logic';

/** The workspace tabs that come back after the first post, as `growth.workspace.tabs.<key>Label`. */
const UNLOCKED_TABS = [
  ['matrices', 'matricesLabel'],
  ['keywords', 'keywordsLabel'],
  ['narrative', 'narrativeLabel'],
  ['seo', 'seoLabel'],
  ['offerings', 'offeringsLabel'],
  ['calendar', 'calendarLabel'],
  ['reports', 'reportsLabel'],
] as const;

export function PublishedCard({
  workspaceId,
  state,
  headingId,
}: {
  workspaceId: string;
  state: Extract<FirstPostState, { phase: 'published' }>;
  headingId: string;
}) {
  const t = useTranslations('tabsA.firstPost.published');
  const tabs = useTranslations('growth.workspace.tabs');
  const format = useFormatter();
  const [copied, setCopied] = useState(false);

  const url = publishedLink(state.url);
  const date = state.publishedAtUtc
    ? format.dateTime(new Date(state.publishedAtUtc), { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <p className={eyebrow}>{date ? t('eyebrow', { date }) : t('eyebrowNoDate')}</p>
      <h2
        id={headingId}
        tabIndex={-1}
        className="mt-1.5 font-display text-[26px] font-semibold leading-tight tracking-tight text-moss focus:outline-none sm:text-[32px]"
      >
        {t('title')}
      </h2>

      <div className="mb-9 mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {url ? (
          <>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-moss px-5 py-2.5 text-[15px] font-semibold text-chalk hover:bg-moss-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
            >
              {t('view')}
              <ExternalLink className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            </a>
            <button type="button" onClick={copy} className={quietLink}>
              {copied ? t('copied') : t('copy')}
            </button>
            <span className="sr-only" aria-live="polite">
              {copied ? t('copied') : ''}
            </span>
          </>
        ) : (
          <p className="text-[14.5px] text-moss-muted">{t('noLink')}</p>
        )}
      </div>

      <div className="border-t border-rule pt-5">
        <p className="font-semibold text-moss">{t('open')}</p>
        <nav aria-label={t('toolsLabel')} className="mt-2">
          <ul className="flex flex-wrap gap-x-1 text-[14px] text-moss-muted">
            {UNLOCKED_TABS.map(([tab, label], i) => (
              <li key={tab} className="inline-flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                <Link
                  href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab } }}
                  className="inline-flex min-h-9 items-center hover:text-moss hover:underline hover:underline-offset-4"
                >
                  {tabs(label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

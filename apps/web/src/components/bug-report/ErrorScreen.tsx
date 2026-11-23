'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { pushConsole } from '@/lib/bug-report/client-buffer';
import { generateRef, refFromDigest } from '@/lib/bug-report/ref';
import { cn } from '@/lib/utils';
import { useBugReport } from './BugReportProvider';
import { RefChip } from './RefChip';

/**
 * Shared body of the two `error.tsx` boundaries. The ref is the same one the
 * server derives from the digest, so it finds the server-side log line; with
 * no digest (a purely client error) a fresh ref is made once.
 */
export function ErrorScreen({
  error,
  reset,
  standalone,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** True when no app shell surrounds the boundary (it sits above the dashboard layout). */
  standalone?: boolean;
}) {
  const t = useTranslations('bugReport.boundary');
  const report = useBugReport();
  const [fallbackRef] = useState(generateRef);
  const refCode = error.digest ? refFromDigest(error.digest) : fallbackRef;

  useEffect(() => {
    pushConsole('error', error.message);
  }, [error]);

  const primary =
    'inline-flex min-h-11 items-center rounded-lg px-5 text-[14px] font-semibold transition-colors';

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-xl flex-col gap-5 px-5 py-16',
        standalone && 'theme-chalk min-h-screen justify-center bg-chalk font-plex text-moss',
      )}
    >
      <h1 className="font-display text-[clamp(1.6rem,4vw,2.2rem)] font-extrabold leading-tight tracking-tight">
        {t('title')}
      </h1>
      <p className="text-[16px] leading-relaxed text-moss-muted">{t('body')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium text-moss-muted">{t('refLabel')}</span>
        <RefChip value={refCode} copyLabel={t('copy')} copiedLabel={t('copied')} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={cn(primary, 'bg-moss text-chalk hover:bg-moss-700')}>
          {t('retry')}
        </button>
        {report ? (
          <button
            type="button"
            onClick={() => report.openReport(refCode)}
            className={cn(primary, 'border border-rule-strong bg-chalk-raised text-moss hover:bg-chalk-sunk')}
          >
            {t('report')}
          </button>
        ) : (
          <Link
            href="/dashboard"
            className={cn(primary, 'border border-rule-strong bg-chalk-raised text-moss hover:bg-chalk-sunk')}
          >
            {t('home')}
          </Link>
        )}
      </div>
    </div>
  );
}

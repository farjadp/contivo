'use client';

import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useBugReport } from './BugReportProvider';

/**
 * Top-bar entry point. A 40px icon on phones (the 5-item bottom bar stays as
 * it is), icon plus label from lg.
 */
export function ReportButton() {
  const t = useTranslations('bugReport.button');
  const report = useBugReport();
  if (!report) return null;

  return (
    <button
      type="button"
      onClick={() => report.openReport()}
      aria-label={t('aria')}
      title={t('label')}
      data-action="report-open"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule bg-chalk-raised text-moss transition-colors hover:border-rule-strong lg:w-auto lg:gap-2 lg:rounded-lg lg:px-3"
    >
      <Flag aria-hidden className="h-[18px] w-[18px]" />
      <span className="hidden text-[14px] font-medium lg:inline">{t('label')}</span>
    </button>
  );
}

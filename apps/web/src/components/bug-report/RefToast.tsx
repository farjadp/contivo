'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { RefChip } from './RefChip';

export const TOAST_MS = 20_000;

/**
 * Non-modal bar: above the phone bottom bar, bottom-start on desktop. It
 * never takes focus; it leaves on its own after 20 s unless the person is
 * hovering or has focus inside it.
 */
export function RefToast({
  refCode,
  onReport,
  onDismiss,
}: {
  refCode: string | null;
  onReport: (ref: string) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('bugReport.toast');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!refCode || paused) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [refCode, paused, onDismiss]);

  if (!refCode) return null;

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
      className="fixed inset-x-3 bottom-24 z-50 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rule-strong bg-chalk-raised p-3 shadow-lg motion-safe:animate-rise md:inset-x-auto md:bottom-6 md:start-6 md:max-w-md"
    >
      <p className="min-w-0 flex-1 basis-40 text-[14px] font-medium leading-snug text-moss">{t('message')}</p>
      <RefChip value={refCode} copyLabel={t('copy')} copiedLabel={t('copied')} />
      <button
        type="button"
        onClick={() => onReport(refCode)}
        className="min-h-11 rounded-lg bg-moss px-4 text-[14px] font-semibold text-chalk transition-colors hover:bg-moss-700"
      >
        {t('report')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-moss-muted hover:bg-chalk-sunk hover:text-moss"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

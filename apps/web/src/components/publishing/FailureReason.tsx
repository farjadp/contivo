'use client';

/**
 * FailureReason.tsx
 *
 * Why a publish failed: a localised headline from the stored `[CODE]`, with
 * the English detail the platform gave us as a smaller secondary line. Rows
 * written before codes existed have only the English, shown as it is.
 */

import { parseFailure, type PublishFailureCode } from '@contivo/types';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export function FailureReason({
  reason,
  label,
  className,
}: {
  /** The stored reason (`[CODE] detail` or legacy English), or one already parsed. */
  reason: string | null | undefined | { code: PublishFailureCode | null; detail: string | null };
  /** Optional lead-in such as "Reason:". */
  label?: string;
  className?: string;
}) {
  const t = useTranslations('errors.publishFailure');
  const { code, detail } =
    reason != null && typeof reason === 'object' ? reason : parseFailure(reason);
  const text = (detail ?? '').trim();
  if (!code && !text) return null;

  return (
    <div className={cn('text-xs', className)}>
      <p>
        {label ? <span className="font-semibold">{label} </span> : null}
        {code ? (
          <span>{t(code)}</span>
        ) : (
          <span dir="auto" className="break-words">{text}</span>
        )}
      </p>
      {code && text ? (
        <p dir="auto" className="mt-0.5 break-words text-[11px] opacity-80">
          {text}
        </p>
      ) : null}
    </div>
  );
}

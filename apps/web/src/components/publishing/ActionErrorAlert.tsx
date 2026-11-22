'use client';

/**
 * ActionErrorAlert.tsx
 *
 * The inline error under a social action button: what failed (the caller's
 * headline), then why, localised by the action's error code. Announced to
 * screen readers when it appears.
 */

import { useTranslations } from 'next-intl';

import type { SocialActionDetail } from '@/lib/social-action-error';
import { cn } from '@/lib/utils';

export function ActionErrorAlert({
  id,
  headline,
  detail,
  className,
}: {
  id?: string;
  headline: string;
  detail: SocialActionDetail | null;
  className?: string;
}) {
  const t = useTranslations('errors.socialAction');
  return (
    <div
      id={id}
      role="alert"
      className={cn('rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700', className)}
    >
      <p className="font-semibold">{headline}</p>
      {detail ? (
        detail.kind === 'message' ? (
          <p className="mt-0.5 text-red-600">{t(detail.key)}</p>
        ) : (
          <p dir="auto" className="mt-0.5 break-words text-red-600">
            {detail.text}
          </p>
        )
      ) : null}
    </div>
  );
}

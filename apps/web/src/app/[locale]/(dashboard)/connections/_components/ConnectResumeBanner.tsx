/**
 * ConnectResumeBanner.tsx
 *
 * B13: a LinkedIn connect that never came back. If the customer had to sign
 * in to LinkedIn midway, LinkedIn can drop them on their feed instead of
 * returning here, and Contivo gets no callback. When they come back to
 * /connections with an attempt recorded and no result in the URL, say what
 * happened and offer one-click retry (they are signed in by now, so the retry
 * goes straight to the consent screen).
 */

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { getSocialConnectUrl } from '@/app/actions/social-connect';
import {
  clearConnectAttempt,
  markConnectAttempt,
  readConnectAttempt,
  type ConnectAttempt,
} from '@/lib/connect-attempt';

interface ConnectResumeBannerProps {
  /** True when the page already shows a connect result (ok, failed, foreign). */
  hasResult: boolean;
}

const PLATFORM_NAMES: Record<ConnectAttempt['platform'], string> = { linkedin: 'LinkedIn' };

export function ConnectResumeBanner({ hasResult }: ConnectResumeBannerProps) {
  const t = useTranslations('connections.resume');
  const [attempt, setAttempt] = useState<ConnectAttempt | null>(null);
  const [error, setError] = useState('');
  const [isRetrying, startRetry] = useTransition();

  // Browser storage is only readable after mount; the server render shows nothing.
  useEffect(() => {
    if (hasResult) {
      clearConnectAttempt();
      return;
    }
    setAttempt(readConnectAttempt());
  }, [hasResult]);

  if (!attempt) return null;

  const platform = PLATFORM_NAMES[attempt.platform];

  const dismiss = () => {
    clearConnectAttempt();
    setAttempt(null);
  };

  const retry = () => {
    setError('');
    startRetry(async () => {
      const result = await getSocialConnectUrl(attempt.platform, attempt.workspaceId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      markConnectAttempt(attempt.platform, attempt.workspaceId);
      window.location.href = result.url;
    });
  };

  return (
    <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">{t('title', { platform })}</p>
      <p className="mt-1 text-amber-800">{t('body', { platform })}</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={retry}
          disabled={isRetrying}
          className="rounded-xl bg-moss px-4 py-2 text-xs font-semibold text-chalk hover:bg-moss-700 transition-colors disabled:opacity-60"
        >
          {isRetrying ? t('retrying') : t('retry', { platform })}
        </button>
        <button
          onClick={dismiss}
          disabled={isRetrying}
          className="rounded-xl border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
        >
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}

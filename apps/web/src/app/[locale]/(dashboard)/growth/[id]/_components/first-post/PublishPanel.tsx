'use client';

/**
 * PublishPanel.tsx
 *
 * The publish half of the first-post draft (spec first-post B §4.4): with
 * LinkedIn connected, "Publish now" (schedule at now; the scheduler picks it
 * up within a minute); without it, the one Connect button. While the post is
 * on its way it shows the wait line, and the PublishOutcomeNotice if the job
 * failed. A refused publish is a returned value, never a thrown error (W2).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';

import { publishNow } from '@/app/actions/publish-now';
import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { Link } from '@/i18n/navigation';
import { markConnectAttempt } from '@/lib/connect-attempt';
import type { LinkedInState } from '@/lib/first-post/types';
import type { PublishOutcome } from '@/lib/publish-outcome';

import { PublishOutcomeNotice } from '../PublishOutcomeNotice';
import type { ConnectFix } from './first-post-view-logic';

export const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-saffron px-5 py-2.5 text-[15px] font-semibold text-moss transition-colors hover:bg-saffron-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:bg-chalk-sunk disabled:text-moss-muted';
export const quietLink =
  'inline-flex min-h-11 items-center text-[14px] font-medium text-moss-700 underline underline-offset-4 hover:text-moss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Starts the fix for "nothing connected": the provider's OAuth (the action
 * logs CHANNEL_CONNECT_STARTED), or the right Connections tab.
 */
export function ConnectFixButton({
  fix,
  workspaceId,
  label,
  busyLabel,
  className = primaryButton,
}: {
  fix: ConnectFix;
  workspaceId: string;
  label: string;
  busyLabel: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (fix.kind === 'connections') {
    return (
      <Link href={{ pathname: '/connections', query: { tab: fix.tab, workspaceId } }} className={className}>
        {label}
      </Link>
    );
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getSocialConnectUrl(fix.platform, workspaceId);
      if ('error' in result) {
        setError(result.error);
        setBusy(false);
        return;
      }
      markConnectAttempt(fix.platform, workspaceId);
      window.location.href = result.url;
    } catch {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={start} disabled={busy} className={className}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? busyLabel : label}
      </button>
      {error ? (
        <span role="alert" className="text-[13px] text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}

type Refusal = 'noConnection' | 'gateBlocked' | 'notFound' | 'failed';

export function PublishPanel({
  workspaceId,
  contentItemId,
  linkedIn,
  mode,
  slow = false,
  outcome = null,
  onStarted,
}: {
  workspaceId: string;
  contentItemId: string;
  linkedIn: LinkedInState;
  /** `ready`: the draft can be published; `publishing`: it is on its way. */
  mode: 'ready' | 'publishing';
  /** Past the 3-minute window: say so, the view now polls every 15 s. */
  slow?: boolean;
  /** The latest publish outcome while publishing (only a failure is shown here). */
  outcome?: PublishOutcome | null;
  /** The item is SCHEDULED at now: the parent switches to the publishing view. */
  onStarted: () => void;
}) {
  const t = useTranslations('tabsA.firstPost');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const linkedInFix: ConnectFix = { kind: 'oauth', platform: 'linkedin' };

  if (mode === 'publishing') {
    if (outcome?.kind === 'failed') return <PublishOutcomeNotice outcome={outcome} workspaceId={workspaceId} />;
    return (
      <div className="flex items-start gap-3 rounded-lg border border-rule bg-chalk-raised px-4 py-3">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-moss-700" aria-hidden="true" />
        <p role="status" aria-live="polite" className="text-[14.5px] text-moss">
          {slow ? t('publishing.slow') : t('publishing.line')}
        </p>
      </div>
    );
  }

  if (!linkedIn.connected) {
    return (
      <div className="space-y-3 rounded-lg border border-rule bg-chalk-raised px-4 py-4">
        <p className="text-[14.5px] text-moss">{t('publish.notConnected')}</p>
        <ConnectFixButton
          fix={linkedInFix}
          workspaceId={workspaceId}
          label={t('publish.connect')}
          busyLabel={t('publish.connecting')}
        />
      </div>
    );
  }

  const publish = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await publishNow(contentItemId);
      if ('ok' in result && result.ok) {
        onStarted();
        return;
      }
      if ('reason' in result) {
        setRefusal(
          result.reason === 'no_connection'
            ? 'noConnection'
            : result.reason === 'quality_gate_blocked'
              ? 'gateBlocked'
              : 'notFound',
        );
      } else {
        setRefusal('failed');
      }
    } catch {
      setRefusal('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-3 rounded-lg border border-moss-700 bg-chalk-raised px-4 py-3 text-[14.5px] font-medium text-moss">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-moss-700 text-chalk">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
        <span>{t.rich('publish.connectedAs', { name: linkedIn.accountName, bdi: (c) => <bdi>{c}</bdi> })}</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" onClick={publish} disabled={busy} className={primaryButton}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? t('publish.publishing') : t('publish.publishNow')}
        </button>
        <Link
          href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: 'pipeline' } }}
          className={quietLink}
        >
          {t('publish.scheduleLater')}
        </Link>
        <span className="text-[13px] text-moss-muted">{t('publish.whatHappens')}</span>
      </div>
      {refusal ? (
        <div role="alert" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
          <p>{t(`publish.${refusal}`)}</p>
          {refusal === 'noConnection' ? (
            <ConnectFixButton
              fix={linkedInFix}
              workspaceId={workspaceId}
              label={t('publish.connect')}
              busyLabel={t('publish.connecting')}
                />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

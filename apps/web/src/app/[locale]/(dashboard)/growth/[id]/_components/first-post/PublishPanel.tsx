'use client';

/**
 * PublishPanel.tsx
 *
 * The publish half of the first-post draft (spec first-post B §4.4). The
 * next-step bar owns "Publish now" and "Connect LinkedIn" (CPO); this panel
 * shows status only. ConnectFixButton stays exported for PipelineTab.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';

import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { Link } from '@/i18n/navigation';
import { markConnectAttempt } from '@/lib/connect-attempt';
import type { PublishRefusal } from '@/lib/first-post/publish-refusal';
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

/**
 * Status only (CPO: the bar owns the action). With LinkedIn connected it says
 * which account and that the post goes live within a minute; without it, that
 * LinkedIn needs connecting. The bar's button does either. While the post is
 * on its way it shows the wait line, or the PublishOutcomeNotice when the job
 * failed. "Schedule for later" stays as the one secondary link.
 */
export function PublishPanel({
  workspaceId,
  linkedIn,
  mode,
  slow = false,
  outcome = null,
  refusal = null,
}: {
  workspaceId: string;
  linkedIn: LinkedInState;
  /** `ready`: the draft can be published; `publishing`: it is on its way. */
  mode: 'ready' | 'publishing';
  /** Past the 3-minute window: say so, the view now polls every 15 s. */
  slow?: boolean;
  /** The latest publish outcome while publishing (only a failure is shown here). */
  outcome?: PublishOutcome | null;
  /** Why the bar's "Publish now" was refused (`?publish=`), shown in the ready state only. */
  refusal?: PublishRefusal | null;
}) {
  const t = useTranslations('tabsA.firstPost');

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

  // A stale "no connection" refusal after connecting says nothing true.
  const shownRefusal = refusal === 'noConnection' && linkedIn.connected ? null : refusal;

  return (
    <div className="space-y-4">
      {linkedIn.connected ? (
        <p className="flex items-center gap-3 rounded-lg border border-moss-700 bg-chalk-raised px-4 py-3 text-[14.5px] font-medium text-moss">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-moss-700 text-chalk">
            <Check className="h-3 w-3" aria-hidden="true" />
          </span>
          <span>
            {t.rich('publish.connectedAs', { name: linkedIn.accountName, bdi: (c) => <bdi>{c}</bdi> })}{' '}
            <span className="font-normal text-moss-muted">{t('publish.whatHappens')}</span>
          </span>
        </p>
      ) : shownRefusal !== 'noConnection' ? (
        <p className="rounded-lg border border-rule bg-chalk-raised px-4 py-3 text-[14.5px] text-moss">
          {t('publish.notConnected')}
        </p>
      ) : null}
      {shownRefusal ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
          {t(`publish.${shownRefusal}`)}
        </p>
      ) : null}
      <Link
        href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: 'pipeline' } }}
        className={quietLink}
      >
        {t('publish.scheduleLater')}
      </Link>
    </div>
  );
}

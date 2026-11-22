'use client';

import { useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';

import { requestMoreCredits } from '@/app/actions/credits';
import { CreditBalancePill, useCreditBalance } from '@/components/shared/credit-balance';
import { AUTOPILOT_RUN_COST, CREDIT_REQUEST_WINDOW_HOURS, isLowBalance } from '@/lib/credit-costs';
import { autopilotRunErrorCode } from '@/lib/autopilot/run-errors';

/**
 * "Request more credits". Credits cannot be bought yet, so this records a
 * request the admin console lists; the copy says the team tops up by hand and
 * promises nothing else.
 */
export function RequestCreditsButton({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('tabsB.credits');
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const onClick = () => {
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await requestMoreCredits(workspaceId);
        if ('error' in result) {
          setOutcome({ kind: 'error', text: result.error });
        } else if (result.status === 'already_requested') {
          setOutcome({
            kind: 'ok',
            text: t('alreadyRequested', {
              when: format.dateTime(new Date(result.requestedAt), { dateStyle: 'medium', timeStyle: 'short' }),
              hours: CREDIT_REQUEST_WINDOW_HOURS,
            }),
          });
        } else {
          setOutcome({ kind: 'ok', text: t('requested') });
        }
      } catch (err) {
        console.error('requestMoreCredits failed:', err);
        setOutcome({ kind: 'error', text: t('requestFailed') });
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {outcome?.kind !== 'ok' && (
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex items-center gap-2 bg-moss px-3.5 py-2 text-[13px] font-semibold text-chalk hover:bg-moss-700 disabled:opacity-60"
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {pending ? t('requesting') : t('request')}
        </button>
      )}
      {outcome && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-[13px] ${outcome.kind === 'ok' ? 'text-moss' : 'text-red-700'}`}
        >
          {outcome.kind === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{outcome.text}</span>
        </p>
      )}
    </div>
  );
}

/** The warning shown once the balance cannot pay for one Autopilot post. */
export function LowCreditNotice({ workspaceId, balance }: { workspaceId: string; balance: number }) {
  const t = useTranslations('tabsB.credits');
  return (
    <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-5 py-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="min-w-0 space-y-2">
        <p className="text-[14px] font-semibold text-moss">
          {balance <= 0 ? t('emptyTitle') : t('lowTitle')}
        </p>
        <p className="text-[13px] text-moss">{t('lowBody', { cost: AUTOPILOT_RUN_COST, balance })}</p>
        <p className="text-[13px] text-moss-muted">{t('earlyAccess')}</p>
        <RequestCreditsButton workspaceId={workspaceId} />
      </div>
    </div>
  );
}

/**
 * Balance on the Autopilot tab. Read through the same server action as the
 * Instant Content widget, and re-read after "Run now" spends.
 */
export function AutopilotCreditPanel({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('tabsB.credits');
  const { balance, loading, failed } = useCreditBalance();

  if (loading) return null;
  if (balance === null) {
    return failed ? <p className="text-[13px] text-red-700">{t('balanceUnavailable')}</p> : null;
  }
  if (isLowBalance(balance)) return <LowCreditNotice workspaceId={workspaceId} balance={balance} />;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-chalk-raised px-5 py-4">
      <CreditBalancePill balance={balance} />
      <p className="min-w-0 flex-1 text-[13px] text-moss-muted">{t('runCost', { cost: AUTOPILOT_RUN_COST })}</p>
      <RequestCreditsButton workspaceId={workspaceId} />
    </div>
  );
}

/**
 * A stored run error as the reader's copy. Known codes (and the English
 * sentences older builds stored for the same outcomes) are translated;
 * anything else is shown as written.
 */
export function useRunErrorText(): (raw: string | null | undefined) => string | null {
  const t = useTranslations('tabsB.credits');
  return (raw) => {
    if (!raw) return null;
    const code = autopilotRunErrorCode(raw);
    return code ? t(`runErrors.${code}`, { cost: AUTOPILOT_RUN_COST }) : raw;
  };
}

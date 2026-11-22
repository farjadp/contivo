'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Coins } from 'lucide-react';

import { getCreditBalanceAction } from '@/app/actions/instant';
import { Skeleton } from '@/components/ui/skeleton';

/** Fired after anything that spends credits, so every balance on the page re-reads. */
export const CREDITS_UPDATED_EVENT = 'credits-updated';

/**
 * The account's balance, read through a server action rather than a browser
 * fetch to the Nest API — that call had no auth token, always 401'd, and the
 * catch block turned the failure into "render nothing", so the widget was
 * permanently invisible instead of visibly broken.
 *
 * `failed` is true when the read errored, so a caller can say so instead of
 * quietly showing nothing.
 */
export function useCreditBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getCreditBalanceAction();
      if ('error' in data) {
        console.error('Failed to load credit balance:', data.error);
        setFailed(true);
        return;
      }
      setFailed(false);
      setBalance(data.balance);
    } catch (err) {
      console.error('Failed to load credit balance:', err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // `instant-form` and Autopilot's "Run now" fire this after spending.
    const onUpdate = () => void load();
    window.addEventListener(CREDITS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, onUpdate);
  }, [load]);

  return { balance, loading, failed };
}

/** The balance as a pill. `low` switches it to the warning colours. */
export function CreditBalancePill({
  balance,
  low = false,
  className = '',
}: {
  balance: number;
  low?: boolean;
  className?: string;
}) {
  const t = useTranslations('shell');
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
        low ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rule bg-chalk-raised text-moss'
      } ${className}`}
    >
      <Coins className={`h-4 w-4 ${low ? 'text-amber-700' : 'text-moss-muted'}`} aria-hidden="true" />
      {/* The count goes through ICU rather than `toLocaleString`, so a Persian
          balance reads ۱٬۲۵۰ and the word sits on the right side of it. */}
      <span>{t('credits.label', { count: balance })}</span>
    </div>
  );
}

export function CreditBalance() {
  const { balance, loading } = useCreditBalance();

  if (loading) {
    return <Skeleton className="h-9 w-24 rounded-full" />;
  }

  if (balance === null) return null;

  return <CreditBalancePill balance={balance} />;
}

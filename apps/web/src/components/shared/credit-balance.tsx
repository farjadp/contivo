'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Coins } from 'lucide-react';

import { getCreditBalanceAction } from '@/app/actions/instant';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Reads the balance through a server action rather than a browser fetch to the
 * Nest API — that call had no auth token, always 401'd, and the catch block
 * turned the failure into "render nothing", so the widget was permanently
 * invisible instead of visibly broken.
 */
export function CreditBalance() {
  const t = useTranslations('shell');
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getCreditBalanceAction();
      if ('error' in data) {
        console.error('Failed to load credit balance:', data.error);
        return;
      }
      setBalance(data.balance);
    } catch (err) {
      console.error('Failed to load credit balance:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // `instant-form` fires this after a generation so the number stays honest.
    const onUpdate = () => void load();
    window.addEventListener('credits-updated', onUpdate);
    return () => window.removeEventListener('credits-updated', onUpdate);
  }, [load]);

  if (loading) {
    return <Skeleton className="h-9 w-24 rounded-full" />;
  }

  if (balance === null) return null;

  return (
    <div className="flex items-center gap-2 border border-rule bg-chalk-raised px-3 py-1.5 rounded-full text-sm font-medium text-moss">
      <Coins className="w-4 h-4 text-moss-muted" />
      {/* The count goes through ICU rather than `toLocaleString`, so a Persian
          balance reads ۱٬۲۵۰ and the word sits on the right side of it. */}
      <span>{t('credits.label', { count: balance })}</span>
    </div>
  );
}

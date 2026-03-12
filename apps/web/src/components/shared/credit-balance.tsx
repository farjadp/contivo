'use client';

import { useEffect, useState } from 'react';
import { getCreditsBalance } from '@/lib/api-client';
import { Coins } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function CreditBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBalance() {
      try {
        const data = await getCreditsBalance(undefined);
        setBalance(data.balance);
      } catch (err) {
        console.error('Failed to load credit balance:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
  }, []);

  if (loading) {
    return <Skeleton className="h-9 w-24 rounded-full" />;
  }

  if (balance === null) return null;

  return (
    <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 px-3 py-1.5 rounded-full text-sm font-medium shadow-sm transition-colors hover:bg-slate-900/80 cursor-default">
      <Coins className="w-4 h-4 text-brand-cyan" />
      <span>{balance.toLocaleString()} credits</span>
    </div>
  );
}

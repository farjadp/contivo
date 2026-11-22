'use client';

/**
 * JobFixButton.tsx
 *
 * The one thing a failed publish row on the Connections page can offer
 * (`jobFixAction` in lib/publish-outcome.ts): Reconnect the account behind
 * it, open Connected accounts when the reconnect cannot start from the row,
 * or connect an account when there is none.
 */

import { Loader2, Plus, RefreshCw } from 'lucide-react';

import type { JobFix } from '@/lib/publish-outcome';

export function JobFixButton({
  fix,
  pending,
  disabled,
  labels,
  onReconnect,
  onOpenAccounts,
  onConnectNew,
}: {
  fix: JobFix;
  pending: boolean;
  disabled?: boolean;
  labels: { reconnect: string; connect: string };
  onReconnect: (connectionId: string) => void;
  onOpenAccounts: () => void;
  onConnectNew: () => void;
}) {
  const onClick =
    fix.kind === 'reconnect'
      ? () => onReconnect(fix.connectionId)
      : fix.kind === 'openAccounts'
        ? onOpenAccounts
        : onConnectNew;
  const Icon = pending ? Loader2 : fix.kind === 'connect' ? Plus : RefreshCw;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className="inline-flex items-center gap-1 text-xs font-semibold text-moss-700 hover:underline disabled:opacity-50"
    >
      <Icon className={pending ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} aria-hidden="true" />
      {fix.kind === 'connect' ? labels.connect : labels.reconnect}
    </button>
  );
}

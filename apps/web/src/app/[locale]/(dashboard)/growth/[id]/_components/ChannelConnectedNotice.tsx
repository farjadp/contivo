/**
 * ChannelConnectedNotice.tsx
 *
 * Shown on the workspace page right after an OAuth connect came back
 * (?connected=<platform>): says it worked and offers exactly one next action.
 * The words and links are decided on the server (connect-return.ts); this
 * component only clears the "connect never came back" marker, because the
 * customer did come back — just not to /connections, which used to clear it.
 */

'use client';

import { ArrowRight, Check, X } from 'lucide-react';
import { useEffect } from 'react';

import { Link } from '@/i18n/navigation';
import { clearConnectAttempt } from '@/lib/connect-attempt';

export function ChannelConnectedNotice({
  title,
  body,
  actionLabel,
  actionHref,
  dismissHref,
  dismissLabel,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  dismissHref: string;
  dismissLabel: string;
}) {
  useEffect(() => {
    clearConnectAttempt();
  }, []);

  return (
    <div
      role="status"
      className="flex flex-col gap-4 border border-green-200 bg-green-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-700 text-white">
          <Check className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-green-900">{title}</p>
          <p className="mt-0.5 text-[13px] text-green-800">{body}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={actionHref as never}
          className="inline-flex min-h-10 items-center gap-2 bg-moss px-4 py-2 text-[13px] font-semibold text-chalk hover:bg-moss-700"
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
        <Link
          href={dismissHref as never}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="inline-flex h-10 w-10 items-center justify-center text-green-900 hover:bg-green-100"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

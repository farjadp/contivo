'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A reference as the person will read it out loud: monospace, tabular, always
 * LTR inside RTL text, and a tap copies it.
 */
export function RefChip({
  value,
  copyLabel,
  copiedLabel,
  className,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, permissions). The ref is still on screen to read out.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? copiedLabel : `${copyLabel}: ${value}`}
      title={copied ? copiedLabel : copyLabel}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong bg-chalk px-3 text-moss transition-colors hover:bg-chalk-sunk',
        className,
      )}
    >
      <bdi dir="ltr" className="font-plexmono text-[15px] font-semibold tracking-wider tabular-nums">
        {value}
      </bdi>
      {copied ? (
        <Check aria-hidden className="h-4 w-4 text-moss-700" />
      ) : (
        <Copy aria-hidden className="h-4 w-4 text-moss-muted" />
      )}
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </button>
  );
}

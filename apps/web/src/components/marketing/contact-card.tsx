'use client';

/**
 * The address, and the two things anyone does with it: copy it, or write.
 *
 * Copy confirms itself by swapping the icon in place: the old one blurs and
 * shrinks out while the tick grows in, in the same cell, so the button never
 * changes width. The announcement for screen readers is a separate live
 * region, because an icon swap says nothing to someone who cannot see it.
 */

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export function CopyAddress({
  email,
  labels,
}: {
  email: string;
  labels: { copy: string; copied: string; selected: string; write: string };
}) {
  const [result, setResult] = useState<'idle' | 'copied' | 'selected'>('idle');
  const copied = result === 'copied';

  useEffect(() => {
    if (result === 'idle') return;
    const id = setTimeout(() => setResult('idle'), 2400);
    return () => clearTimeout(id);
  }, [result]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setResult('copied');
    } catch {
      // Clipboard can be refused (an insecure context, a denied permission,
      // an embedded browser). Selecting the text leaves the visitor one
      // keystroke from copying it, and the status line says so.
      const node = document.getElementById('contact-address');
      if (node) window.getSelection()?.selectAllChildren(node);
      setResult('selected');
    }
  };

  const swap = 'col-start-1 row-start-1 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none';

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <a
        id="contact-address"
        href={`mailto:${email}`}
        className="break-all font-display text-[clamp(1.6rem,4.4vw,3.2rem)] font-bold leading-none tracking-[-0.02em] underline decoration-saffron decoration-[3px] underline-offset-[10px] transition-colors hover:decoration-chalk"
      >
        <bdi>{email}</bdi>
      </a>

      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-12 items-center gap-2.5 rounded-xl border border-forest-line px-5 text-[15px] font-semibold transition-colors duration-200 hover:bg-forest-line/40"
        >
          <span aria-hidden className="grid h-5 w-5 place-items-center">
            <svg
              viewBox="0 0 20 20"
              className={cn(swap, 'h-5 w-5', copied ? 'scale-50 opacity-0 blur-[2px]' : 'scale-100 opacity-100')}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <rect x="6.5" y="6.5" width="10" height="10" rx="2" />
              <path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />
            </svg>
            <svg
              viewBox="0 0 20 20"
              className={cn(swap, 'h-5 w-5 text-saffron', copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0 blur-[2px]')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {labels.copy}
        </button>
        <a
          href={`mailto:${email}`}
          className="inline-flex h-12 items-center rounded-xl bg-saffron px-5 text-[15px] font-semibold text-moss transition-colors duration-200 hover:bg-saffron-soft"
        >
          {labels.write}
        </a>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-[1.25rem] font-plexmono text-[12px] text-forest-muted transition-opacity duration-300 sm:basis-full',
          result === 'idle' ? 'opacity-0' : 'opacity-100',
        )}
      >
        {result === 'copied' ? labels.copied : result === 'selected' ? labels.selected : ''}
      </p>
    </div>
  );
}

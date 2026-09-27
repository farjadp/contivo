'use client';

/**
 * Motion for the site's reading pages — legal, company, the sample report.
 *
 * These pages are read, not demonstrated, so their motion does one job each:
 * show where you are in a long document (progress, the contents rail), and
 * answer the pointer on things that can be clicked (the spotlight). None of it
 * carries meaning a still page lacks, and all of it stops under
 * prefers-reduced-motion.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

// ─── Reading progress ────────────────────────────────────────────────────────

/**
 * A saffron hairline under the nav that fills as the article is read.
 *
 * Driven by scaleX on one element rather than by width, so a scroll never
 * triggers layout. It measures the article it is given, not the whole page,
 * so the footer does not count as unread text. Origin follows the reading
 * direction: it fills from the right on the Persian page.
 */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const el = bar.current;
    if (!target || !el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const read = Math.min(1, Math.max(0, -rect.top / Math.max(total, 1)));
      el.style.transform = `scaleX(${read})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [targetId]);

  return (
    <div aria-hidden className="pointer-events-none sticky top-16 z-30 h-[2px] w-full">
      <div
        ref={bar}
        className="h-full w-full origin-left scale-x-0 bg-saffron rtl:origin-right"
      />
    </div>
  );
}

// ─── Contents rail with scroll-spy ───────────────────────────────────────────

export type TocItem = { id: string; label: string; num: string };

/**
 * The document's contents, with the section being read marked.
 *
 * The marker is a saffron bar that grows in beside the active entry; the
 * active section is the last one whose heading has crossed a line a third of
 * the way down the viewport, which is where the eye actually is — not the
 * first one that happens to be intersecting.
 */
export function ContentsRail({ items, title }: { items: TocItem[]; title: string }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!headings.length) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.33;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [items]);

  return (
    <nav aria-label={title} className="text-[14px]">
      <p className="mb-4 font-plexmono text-[11px] uppercase tracking-[0.14em] text-moss-muted">{title}</p>
      <ol className="border-s border-rule">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id} className="relative">
              <span
                aria-hidden
                className={cn(
                  'absolute -start-px top-0 h-full w-[3px] origin-top bg-saffron transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none',
                  on ? 'scale-y-100' : 'scale-y-0',
                )}
              />
              <a
                href={`#${item.id}`}
                aria-current={on ? 'location' : undefined}
                className={cn(
                  'flex gap-3 py-2 ps-4 leading-snug transition-colors duration-200',
                  on ? 'text-moss' : 'text-moss-muted hover:text-moss',
                )}
              >
                <span className="tnum font-plexmono text-[12px] leading-[1.6] opacity-70">{item.num}</span>
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Spotlight ───────────────────────────────────────────────────────────────

/**
 * A card that lights up where the pointer is.
 *
 * The glow is a radial gradient positioned by two custom properties, so the
 * pointer only ever writes two CSS variables — no re-render, no layout. On
 * touch screens there is no hover and the card is simply a card.
 */
export function Spotlight({
  children,
  className,
  tone = 'chalk',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'chalk' | 'forest';
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
      className={cn(
        'group/spot relative isolate overflow-hidden',
        'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:opacity-0 before:transition-opacity before:duration-500 hover:before:opacity-100 motion-reduce:before:hidden',
        tone === 'chalk'
          ? 'before:bg-[radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,50%),rgba(227,162,26,.16),transparent_60%)]'
          : 'before:bg-[radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,50%),rgba(227,162,26,.22),transparent_60%)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

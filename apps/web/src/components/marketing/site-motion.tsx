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

// ─── A line drawn by scrolling ───────────────────────────────────────────────

/**
 * A vertical rule that draws itself down its container as the container
 * passes the middle of the screen, for timelines. Absolutely positioned: put
 * it inside a `relative` parent and it spans that parent's height. Under
 * reduced motion it is simply drawn.
 */
export function ScrollLine({ className }: { className?: string }) {
  const line = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = line.current;
    const host = el?.parentElement?.parentElement;
    if (!el || !host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = 'scaleY(1)';
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const r = host.getBoundingClientRect();
      const mid = window.innerHeight * 0.55;
      const p = Math.min(1, Math.max(0, (mid - r.top) / Math.max(r.height, 1)));
      el.style.transform = `scaleY(${p})`;
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
  }, []);

  return (
    <div aria-hidden className={cn('pointer-events-none absolute w-[2px] bg-rule', className)}>
      <div ref={line} className="h-full w-full origin-top scale-y-0 bg-saffron" />
    </div>
  );
}

// ─── The footer wordmark ─────────────────────────────────────────────────────

/**
 * The brand name set very large, each letter rising out of a clipped line the
 * first time it scrolls into view. The server renders it in place, so without
 * JavaScript or with reduced motion it is simply there.
 */
export function Wordmark({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static');

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setState('hidden');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('shown');
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <p ref={ref} dir="ltr" aria-label={text} className={cn('flex overflow-hidden', className)}>
      {[...text].map((ch, i) => (
        <span
          key={i}
          aria-hidden
          style={state === 'shown' ? { transitionDelay: `${i * 55}ms` } : undefined}
          className={cn(
            'inline-block transition-transform duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)]',
            state === 'hidden' ? 'translate-y-[105%]' : 'translate-y-0',
          )}
        >
          {ch}
        </span>
      ))}
    </p>
  );
}

// ─── Section tabs with scroll-spy ────────────────────────────────────────────

export type SectionTab = { id: string; label: string; num: string };

/**
 * A row of anchors that sticks under the nav and marks the section in view.
 * The same reading-line rule as the contents rail: the active section is the
 * last one whose top has passed a third of the way down the screen. On a
 * phone the row scrolls sideways and keeps the active tab in view.
 */
export function SectionTabs({ items, label }: { items: SectionTab[]; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const row = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.33;
      let current: string | null = null;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) current = s.id;
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

  useEffect(() => {
    if (!active) return;
    const el = row.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <nav aria-label={label} className="sticky top-16 z-30 border-b border-rule bg-chalk/[.94] backdrop-blur-sm">
      <ul ref={row} className="mx-auto flex max-w-[90rem] gap-1.5 overflow-x-auto px-5 py-3 [scrollbar-width:none] md:px-16">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id} data-tab={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={on ? 'location' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14px] font-medium transition-colors duration-300',
                  on ? 'bg-moss text-chalk' : 'text-moss-muted hover:bg-chalk-sunk hover:text-moss',
                )}
              >
                <span className={cn('tnum font-plexmono text-[12px]', on ? 'text-saffron' : 'text-saffron-ink')}>
                  {item.num}
                </span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

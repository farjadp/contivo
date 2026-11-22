'use client';

/**
 * The Loop, as the home page's second section (Farjad, 22 Nov 2026: "the
 * circle that shows everything").
 *
 * The old hero ring named the six stages. This one shows them: picking a stage
 * (on the ring or on its tab) puts that stage's own evidence beside it. Four
 * are captures of a real workspace, one is the cadence control, one is the run
 * log, which says "example" in its own title.
 *
 * It turns on its own while it is on screen, and stops for good the moment
 * the visitor picks a stage. It waits while they read the panel (hover) or
 * have keyboard focus inside. The server renders stage
 * one, fully visible; nothing waits on script to be readable.
 */

import Image from 'next/image';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { CadenceWeek, RunLog } from './home-interactions';

const STAGES = ['know', 'watch', 'think', 'make', 'ship', 'learn'] as const;
type Stage = (typeof STAGES)[number];

/* Six nodes on a circle of r=220 around (360,300), starting at the top. The
   plot is pinned LTR, so the loop runs clockwise in every language. */
const R = 220;
const CIRCUMFERENCE = 2 * Math.PI * R;
const NODES: Record<Stage, { x: number; y: number; lx: number; ly: number; anchor: 'start' | 'middle' | 'end' }> = {
  know: { x: 360, y: 80, lx: 360, ly: 4, anchor: 'middle' },
  watch: { x: 550.5, y: 190, lx: 598, ly: 184, anchor: 'start' },
  think: { x: 550.5, y: 410, lx: 604, ly: 404, anchor: 'start' },
  make: { x: 360, y: 520, lx: 360, ly: 588, anchor: 'middle' },
  ship: { x: 169.5, y: 410, lx: 122, ly: 404, anchor: 'end' },
  learn: { x: 169.5, y: 190, lx: 122, ly: 184, anchor: 'end' },
};

const ADVANCE_MS = 4200;

export function LoopExplorer() {
  const t = useTranslations('home.loop');
  const th = useTranslations('home');
  const format = useFormatter();
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [picked, setPicked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (picked || paused || !visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      if (!document.hidden) setStage((s) => (s + 1) % STAGES.length);
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [picked, paused, visible]);

  const pick = (i: number) => {
    setStage(i);
    setPicked(true);
  };

  /* Arrow keys move between tabs, as a tablist should; the ring is pinned
     LTR, so right always means the next stage. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (stage + step + STAGES.length) % STAGES.length;
    pick(next);
    document.getElementById(`loop-tab-${STAGES[next]}`)?.focus();
  };

  const num = (i: number) => format.number(i + 1, { minimumIntegerDigits: 2 });
  const current = STAGES[stage];

  const exhibits: Record<Stage, ReactNode> = {
    know: <Capture src="/marketing/brand-memory.webp" w={1800} h={1212} alt={th('v2.steps.s1.alt')} />,
    watch: <Capture src="/marketing/market-map.webp" w={1800} h={1074} alt={th('v2.steps.s2.alt')} />,
    /* A wide strip (1800x400): shown whole, not cropped to the others' shape. */
    think: <Capture src="/marketing/setup-chain.webp" w={1800} h={400} alt={th('actTwo.chainAlt')} natural />,
    make: <Capture src="/marketing/generated-post.webp" w={1400} h={1114} alt={th('v2.steps.s3.alt')} />,
    ship: <CadenceWeek />,
    learn: <RunLog />,
  };

  return (
    <div
      ref={ref}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-14"
    >
      <div className="flex flex-col items-center gap-5">
        {/* LTR wrapper: text-anchor start/end flip under RTL. Persian and
            Arabic labels still shape correctly inside it. */}
        <div dir="ltr" className="w-full max-w-[19rem] sm:max-w-[27rem]">
          <svg viewBox="0 -16 720 636" className="h-auto w-full" aria-hidden>
            <circle cx="360" cy="300" r={R} fill="none" className="stroke-rule-strong" strokeWidth="2" strokeDasharray="6 8" />
            {/* How far round the loop the picked stage is. */}
            <circle
              cx="360"
              cy="300"
              r={R}
              fill="none"
              transform="rotate(-90 360 300)"
              className="stroke-moss transition-[stroke-dashoffset] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - stage / STAGES.length)}
            />
            <text x="360" y="292" textAnchor="middle" className="fill-moss font-display text-[40px] font-extrabold">
              {t('title')}
            </text>
            <text x="360" y="326" textAnchor="middle" className="fill-moss-muted font-plexmono text-[15px]">
              {t('sub')}
            </text>
            <circle
              key={current}
              cx={NODES[current].x}
              cy={NODES[current].y}
              r="42"
              fill="none"
              className="stroke-saffron [transform-box:fill-box] [transform-origin:center] motion-safe:animate-ripple"
              strokeWidth="3"
            />
            {STAGES.map((s, i) => {
              const n = NODES[s];
              const isCurrent = i === stage;
              const done = i < stage;
              return (
                <g key={s} onClick={() => pick(i)} className="cursor-pointer">
                  {/* A generous hit area: the visible node is about 16px
                      across on a phone. */}
                  <circle cx={n.x} cy={n.y} r="62" fill="transparent" />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={isCurrent ? 42 : 34}
                    className={cn(
                      'transition-all duration-300',
                      isCurrent && 'fill-saffron stroke-moss',
                      done && 'fill-moss stroke-moss',
                      !isCurrent && !done && 'fill-chalk stroke-rule-strong',
                    )}
                    strokeWidth={isCurrent ? 3 : 2}
                  />
                  <text
                    x={n.x}
                    y={n.y + 6}
                    textAnchor="middle"
                    className={cn(
                      'font-plexmono text-[17px] font-medium',
                      done ? 'fill-chalk' : isCurrent ? 'fill-moss' : 'fill-moss-muted',
                    )}
                  >
                    {num(i)}
                  </text>
                  <text
                    x={n.lx}
                    y={n.ly}
                    textAnchor={n.anchor}
                    className={cn('text-[18px] max-sm:hidden', isCurrent ? 'fill-moss font-bold' : 'fill-moss font-semibold')}
                  >
                    {t(`stages.${s}.name`)}
                  </text>
                  <text x={n.lx} y={n.ly + 20} textAnchor={n.anchor} className="fill-moss-muted text-[14px] max-sm:hidden">
                    {t(`stages.${s}.short`)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div role="tablist" aria-label={t('tabsLabel')} onKeyDown={onKey} className="flex flex-wrap justify-center gap-1.5">
          {STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              role="tab"
              id={`loop-tab-${s}`}
              aria-selected={i === stage}
              aria-controls={`loop-panel-${s}`}
              tabIndex={i === stage ? 0 : -1}
              onClick={() => pick(i)}
              className={cn(
                'h-10 rounded-full border px-3.5 font-plexmono text-[13px] font-medium transition-colors',
                i === stage ? 'border-moss bg-moss text-chalk' : 'border-rule-strong text-moss hover:border-moss',
              )}
            >
              {num(i)} {t(`stages.${s}.name`)}
            </button>
          ))}
        </div>
      </div>

      {/* All six panels share one grid cell, so the section is as tall as its
          tallest stage and never jumps when the stage changes. */}
      {/* Hover pauses only here, where someone is reading. Pausing on the
          whole section left the ring still for most desktop visitors, whose
          pointer rests somewhere over it after scrolling. */}
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="grid grid-cols-[minmax(0,1fr)] [&>*]:col-start-1 [&>*]:row-start-1"
      >
        {STAGES.map((s, i) => {
          const on = i === stage;
          return (
            <div
              key={s}
              id={`loop-panel-${s}`}
              role="tabpanel"
              aria-labelledby={`loop-tab-${s}`}
              className={cn(
                'flex min-w-0 flex-col gap-4 transition-[opacity,transform] duration-300',
                on ? 'opacity-100 delay-150' : 'pointer-events-none invisible translate-y-2 opacity-0',
              )}
            >
              <p className="font-plexmono text-[13px] text-saffron-ink">
                <bdi>{t('position', { n: num(i) })}</bdi>
              </p>
              <h3 className="font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-bold leading-[1.1]">{t(`stages.${s}.title`)}</h3>
              <p className="max-w-[40rem] text-[16px] leading-[1.65] text-moss-muted">{t(`stages.${s}.body`)}</p>
              <div className="mt-1">{exhibits[s]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Capture({ src, alt, w, h, natural }: { src: string; alt: string; w: number; h: number; natural?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-chalk">
      <Image
        src={src}
        alt={alt}
        width={w}
        height={h}
        className={cn('h-auto w-full', !natural && 'aspect-[16/10] object-cover object-top')}
        sizes="(min-width: 1024px) 46vw, 92vw"
      />
    </div>
  );
}

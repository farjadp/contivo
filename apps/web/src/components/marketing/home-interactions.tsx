'use client';

/**
 * The homepage's moving parts.
 *
 * Each one demonstrates something the product actually does — the loop, the
 * read, the refusal, the cadence, the run log — rather than decorating. They
 * all degrade to a still, complete picture under prefers-reduced-motion: every
 * animation class is `motion-safe:` and every timer checks the same setting.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

// ─── Shared hooks ─────────────────────────────────────────────────────────────

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view (and stays true). */
function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

/**
 * Rises into place the first time it scrolls into view.
 *
 * Server HTML is fully visible; only an element that is still below the fold
 * after hydration is hidden, so nothing flashes and nothing depends on JS.
 */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static');

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState('hidden');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('shown');
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      style={state === 'shown' ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]',
        state === 'hidden' && 'translate-y-6 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── The loop ring ────────────────────────────────────────────────────────────

const STAGES = ['know', 'watch', 'think', 'make', 'ship', 'learn'] as const;
type Stage = (typeof STAGES)[number];

/* Six nodes on a circle of r=220 around (360,300), starting at the top.
   The plot is pinned LTR: the loop runs clockwise in both languages. */
const NODES: Record<Stage, { x: number; y: number; lx: number; ly: number; anchor: 'start' | 'middle' | 'end' }> = {
  know: { x: 360, y: 80, lx: 360, ly: 22, anchor: 'middle' },
  watch: { x: 550.5, y: 190, lx: 598, ly: 184, anchor: 'start' },
  think: { x: 550.5, y: 410, lx: 604, ly: 404, anchor: 'start' },
  make: { x: 360, y: 520, lx: 360, ly: 576, anchor: 'middle' },
  ship: { x: 169.5, y: 410, lx: 122, ly: 404, anchor: 'end' },
  learn: { x: 169.5, y: 190, lx: 122, ly: 184, anchor: 'end' },
};

export function LoopRing() {
  const t = useTranslations('home.loop');
  const format = useFormatter();
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(2);
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (picked || reduced) return;
    const id = setInterval(() => setStage((s) => (s + 1) % 6), 3200);
    return () => clearInterval(id);
  }, [picked, reduced]);

  const current = STAGES[stage];
  const node = NODES[current];
  const num = (i: number) => format.number(i + 1, { minimumIntegerDigits: 2 });

  return (
    <figure className="flex flex-col items-center gap-4">
      {/* LTR wrapper: text-anchor start/end flip under RTL, and the loop runs
          clockwise in both languages. Persian labels still shape correctly. */}
      <div dir="ltr" className="w-full max-w-[640px]">
      <svg
        viewBox="0 0 720 600"
        className="h-auto w-full"
        role="img"
        aria-label={STAGES.map((s) => t(`stages.${s}.name`)).join(' → ')}
      >
        <circle cx="360" cy="300" r="220" fill="none" className="stroke-rule-strong" strokeWidth="2" strokeDasharray="6 8" />
        <path
          d="M360 80 A220 220 0 0 1 550.5 410"
          fill="none"
          className="stroke-moss motion-safe:animate-draw"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="461"
        />
        <circle
          cx={node.x}
          cy={node.y}
          r="50"
          fill="none"
          className="stroke-moss transition-all duration-500 ease-[cubic-bezier(.2,.7,.2,1)]"
          strokeWidth="2"
          strokeDasharray="3 5"
        />
        <text x="360" y="292" textAnchor="middle" className="fill-moss font-display text-[40px] font-extrabold">
          {t('title')}
        </text>
        <text x="360" y="326" textAnchor="middle" className="fill-moss-muted font-plexmono text-[15px]">
          {t('sub')}
        </text>
        {/* The one stage the product is waiting on: saffron, locked, rippling. */}
        <circle
          cx="550.5"
          cy="410"
          r="40"
          fill="none"
          className="stroke-saffron [transform-box:fill-box] [transform-origin:center] motion-safe:animate-ripple"
          strokeWidth="3"
        />
        {STAGES.map((s, i) => {
          const n = NODES[s];
          const done = i < 2;
          const isThink = s === 'think';
          return (
            <g key={s}>
              <g
                className="[transform-box:fill-box] [transform-origin:center] motion-safe:animate-pop"
                style={{ animationDelay: `${300 + i * 250}ms` }}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={isThink ? 40 : 34}
                  className={cn(
                    done && 'fill-moss',
                    isThink && 'fill-saffron stroke-moss',
                    !done && !isThink && 'fill-chalk-raised stroke-rule-strong',
                  )}
                  strokeWidth={isThink ? 3 : 2}
                  strokeDasharray={!done && !isThink ? '4 4' : undefined}
                />
                {isThink ? (
                  <>
                    <rect x={n.x - 10.5} y={n.y - 6} width="21" height="16" rx="3" className="fill-moss" />
                    <path d={`M${n.x - 6.5} ${n.y - 6} v-5 a6.5 6.5 0 0 1 13 0 v5`} fill="none" className="stroke-moss" strokeWidth="3" />
                  </>
                ) : (
                  <text
                    x={n.x}
                    y={n.y + 6}
                    textAnchor="middle"
                    className={cn('font-plexmono text-[17px] font-medium', done ? 'fill-chalk' : 'fill-moss-muted')}
                  >
                    {num(i)}
                  </text>
                )}
              </g>
              <text x={n.lx} y={n.ly} textAnchor={n.anchor} className="fill-moss text-[18px] font-semibold max-sm:hidden">
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

      <div role="tablist" aria-label={t('tabsLabel')} className="flex flex-wrap justify-center gap-1.5">
        {STAGES.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`loop-tab-${s}`}
            aria-selected={i === stage}
            aria-controls="loop-panel"
            onClick={() => {
              setStage(i);
              setPicked(true);
            }}
            className={cn(
              'h-10 rounded-full border px-3.5 font-plexmono text-[13px] font-medium transition-colors',
              i === stage ? 'border-moss bg-moss text-chalk' : 'border-rule-strong text-moss hover:border-moss',
            )}
          >
            {num(i)} {t(`stages.${s}.name`)}
          </button>
        ))}
      </div>

      <div
        key={current}
        id="loop-panel"
        role="tabpanel"
        aria-labelledby={`loop-tab-${current}`}
        className="flex min-h-[104px] w-full max-w-[560px] flex-col gap-1.5 rounded-xl border border-rule bg-chalk-raised px-5 py-4 motion-safe:animate-fade-in"
      >
        <strong className="text-[17px]">{t(`stages.${current}.title`)}</strong>
        <span className="text-[15px] leading-relaxed text-moss-muted">{t(`stages.${current}.body`)}</span>
      </div>
    </figure>
  );
}

// ─── What happens after "Read" ────────────────────────────────────────────────

/* Each step, and which loop stage it belongs to. The stage number is formatted,
   not written: a literal '01' stays Latin on the Persian page. */
const STEP_KEYS = [
  ['read', 1],
  ['memory', 1],
  ['competitors', 2],
  ['charts', 2],
] as const;

export function IntakeSteps() {
  const t = useTranslations('home.steps');
  const format = useFormatter();
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const [phase, setPhase] = useState(-1);

  useEffect(() => {
    if (!seen || reduced) return;
    let p = 0;
    setPhase(0);
    const id = setInterval(() => {
      p = p >= 5 ? 0 : p + 1;
      setPhase(p);
    }, 1100);
    return () => clearInterval(id);
  }, [seen, reduced]);

  return (
    <div ref={ref} className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-rule-strong px-5 py-4">
      <span className="font-plexmono text-[12px] text-moss-muted">{t('heading')}</span>
      <ol className="flex flex-col gap-2">
        {STEP_KEYS.map(([key, stage], i) => {
          const done = reduced || phase > i;
          const active = !reduced && phase === i;
          return (
            <li key={key} className={cn('flex items-center gap-3 text-[15px] transition-opacity duration-300', !done && !active && phase >= 0 && 'opacity-45')}>
              {done ? (
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-moss-700 motion-safe:animate-pop">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-chalk">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                </span>
              ) : active ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" className="animate-spin stroke-saffron">
                  <path d="M12 3a9 9 0 1 1-9 9" />
                </svg>
              ) : (
                <span className="m-0.5 h-[18px] w-[18px] rounded-full border-2 border-dashed border-rule-strong" />
              )}
              <span className="flex-1">{t(key)}</span>
              <span className="font-plexmono text-[12px] text-moss-muted">
                {format.number(stage, { minimumIntegerDigits: 2 })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── The refusal, pressable ───────────────────────────────────────────────────

const CHAIN = [
  ['brand', 'done'],
  ['market', 'done'],
  ['keywords', 'next'],
  ['ideas', 'locked'],
  ['channel', 'locked'],
  ['autopilot', 'locked'],
] as const;

export function TryTheLock() {
  const t = useTranslations('home.tryIt');
  const format = useFormatter();
  const [attempts, setAttempts] = useState(0);
  const [shaking, setShaking] = useState(false);

  function press() {
    setAttempts((a) => a + 1);
    // Restart the shake even on rapid presses: drop the class, then re-add it
    // on the next frame.
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  }

  const line = t(`lines.${Math.min(attempts, 4)}` as 'lines.0');

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 rounded-2xl bg-moss p-6">
        <span className="font-plexmono text-[12px] uppercase tracking-widest text-forest-muted">{t('label')}</span>
        <button
          type="button"
          onClick={press}
          onAnimationEnd={() => setShaking(false)}
          className={cn(
            'flex h-14 items-center justify-center gap-2.5 rounded-xl border-2 border-saffron text-[17px] font-semibold text-chalk transition-colors hover:bg-forest',
            shaking && 'motion-safe:animate-shake',
          )}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" className="stroke-saffron">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {t('button')}
        </button>
        <p key={attempts} aria-live="assertive" className={cn('min-h-[72px] text-[15px] leading-relaxed motion-safe:animate-fade-in', attempts ? 'text-chalk' : 'text-forest-muted')}>
          {line}
        </p>
        <span className="font-plexmono text-[12px] text-forest-muted">{t('attempts', { count: attempts })}</span>
      </div>

      <ol className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {CHAIN.map(([key, state], i) => (
          <li
            key={key}
            className={cn(
              'flex flex-col gap-0.5 border-t-[3px] px-3.5 py-3',
              state === 'done' && 'border-chalk',
              state === 'next' && 'rounded-b-xl border-saffron bg-moss',
              state === 'next' && shaking && 'motion-safe:animate-shake',
              state === 'locked' && 'border-dashed border-forest-muted/60',
            )}
          >
            <span className={cn('font-plexmono text-[12px]', state === 'next' ? 'text-saffron' : 'text-forest-muted')}>
              {format.number(i + 1, { minimumIntegerDigits: 2 })} · {t(`chain.${state}`)}
            </span>
            <span className={cn('font-semibold', state === 'locked' && 'text-forest-muted')}>{t(`chain.${key}`)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Cadence ──────────────────────────────────────────────────────────────────

/* Which weekday gets the next post: spread out first, then fill the gaps. */
const SPREAD = [0, 3, 5, 1, 4, 6, 2];

export function CadenceWeek() {
  const t = useTranslations('home.cadence');
  const format = useFormatter();
  const locale = useLocale();
  const [perWeek, setPerWeek] = useState(5);

  // A known Monday (en) or Saturday (fa), so the strip starts where each
  // reader's week starts and the weekday names come from the locale.
  const start = locale === 'fa' ? new Date(Date.UTC(2026, 0, 3, 12)) : new Date(Date.UTC(2026, 0, 5, 12));
  const counts = Array(7).fill(0) as number[];
  for (let k = 0; k < perWeek; k++) counts[SPREAD[k % 7]]++;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-rule bg-chalk-raised p-6">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="cadence" className="font-plexmono text-[11px] uppercase tracking-widest text-moss-muted">
          {t('label')}
        </label>
        <output htmlFor="cadence" className="font-display text-[24px] font-bold">
          {t('value', { count: perWeek })}
        </output>
      </div>
      <input
        id="cadence"
        type="range"
        min={1}
        max={14}
        value={perWeek}
        onChange={(e) => setPerWeek(Number(e.target.value))}
        className="h-11 w-full accent-moss"
      />
      <ol className="grid grid-cols-7 gap-2">
        {counts.map((c, i) => {
          const day = new Date(start);
          day.setUTCDate(start.getUTCDate() + i);
          return (
            <li key={i} className="flex flex-col items-center gap-1.5">
              <div className="flex h-[120px] w-full flex-col justify-end gap-[5px] rounded-lg bg-chalk-sunk p-1.5">
                {Array.from({ length: c }, (_, j) => (
                  <span
                    key={`${perWeek}-${j}`}
                    className="h-[22px] rounded border border-moss bg-saffron motion-safe:animate-pop"
                    style={{ animationDelay: `${i * 40 + j * 80}ms` }}
                  />
                ))}
              </div>
              <span className="font-plexmono text-[12px] text-moss-muted">
                {format.dateTime(day, { weekday: 'narrow', timeZone: 'UTC' })}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[14px] text-moss-muted">{t('caption')}</p>
    </div>
  );
}

// ─── Run log ──────────────────────────────────────────────────────────────────

const LOG_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;
const LOG_TIMES = ['09:00', '09:00', '09:01', '09:01', '09:02', '09:02'];

export function RunLog() {
  const t = useTranslations('home.log');
  const [ref, seen] = useInView<HTMLElement>(0.3);
  const [run, setRun] = useState(0);

  return (
    <figure ref={ref} className="flex flex-col gap-2.5 rounded-2xl bg-moss p-6 font-plexmono text-[14px] leading-normal text-chalk">
      <div className="flex items-center justify-between text-[12px] text-forest-muted">
        <figcaption>{t('title')}</figcaption>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="h-9 rounded-full border border-forest-muted/60 px-3.5 text-chalk hover:border-chalk"
        >
          {t('replay')}
        </button>
      </div>
      <ol className="flex flex-col">
        {LOG_ROWS.map((row, i) => (
          <li
            key={`${run}-${row}`}
            className={cn(
              'grid grid-cols-[56px_96px_minmax(0,1fr)] gap-2 border-t border-forest-line py-1.5',
              seen ? 'motion-safe:animate-fade-in' : 'motion-safe:opacity-0',
            )}
            style={{ animationDelay: `${i * 450}ms` }}
          >
            <span className="text-forest-muted">{LOG_TIMES[i]}</span>
            <span className={row === 'r3' ? 'text-saffron' : row === 'r5' || row === 'r6' ? 'text-forest-muted' : ''}>
              {t(`rows.${row}.kind`)}
            </span>
            <span>{t(`rows.${row}.text`)}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

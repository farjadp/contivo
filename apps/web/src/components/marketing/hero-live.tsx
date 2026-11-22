'use client';

/**
 * The home page's two moving demos (Farjad, 22 Nov 2026: "the old hero was
 * better, this one is too static").
 *
 * LiveWeek (hero): the visitor's own address goes in, a week of posts comes
 * out. It shows the result, so the hero stays result first while moving.
 * GateDemo (section 4): one draft held by the gate, then a rewrite passing.
 *
 * Both are labelled illustrations, and both only act out what the product
 * really does:
 * - the brand-memory fields and the LinkedIn / own-site channels are the live
 *   ones;
 * - the flagged opener is one of the humanizer's own tells
 *   (lib/humanize.ts, EN_TELLS / FA_TELLS);
 * - the veto is the judge's "invented statistics" rule;
 * - scores are out of ten, as the judge gives them.
 *
 * Text is never hidden while it waits to move: the server renders the finished
 * state, and the loop only starts after mount, when motion is allowed and the
 * demo is on screen.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/* ─── Shared timing ──────────────────────────────────────────────────────── */

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

/**
 * A tick that counts up while the element is on screen and the tab is
 * visible, and wraps at `length`. `null` means "not animating": render the
 * finished state. That covers the server render, reduced motion and the time
 * before the element is first seen.
 */
function useLoop(ref: React.RefObject<HTMLElement | null>, length: number, stepMs: number) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    if (reduced || !visible) return;
    setTick((t) => t ?? 0);
    const id = setInterval(() => {
      if (document.hidden) return;
      setTick((t) => ((t ?? 0) + 1) % length);
    }, stepMs);
    return () => clearInterval(id);
  }, [reduced, visible, length, stepMs]);

  const restart = useCallback(() => {
    if (!reduced) setTick(0);
  }, [reduced]);

  return { tick: reduced ? null : tick, restart };
}

/* ─── LiveWeek ───────────────────────────────────────────────────────────── */

const FIELDS = ['sells', 'audience', 'tone', 'competitors'] as const;
/* Which days get a post, and where it goes. Five a week, a mix of the two
   live channels, with a gap so the week does not read as "every day". */
const SLOTS: ReadonlyArray<{ day: number; channel: 'linkedin' | 'site' }> = [
  { day: 0, channel: 'linkedin' },
  { day: 1, channel: 'site' },
  { day: 2, channel: 'linkedin' },
  { day: 3, channel: 'linkedin' },
  { day: 5, channel: 'site' },
];
const LIVE_STEPS = 22; // ≈ 10s a cycle at 450ms
const CHIPS_FROM = 1; // chips at ticks 1-4
const POSTS_FROM = 6; // posts at ticks 6-10
const CHECKED_AT = 12;

/** What the visitor typed, cut down to a host for display. */
function hostOf(raw: string): string {
  const s = raw.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#\s]/)[0] ?? '';
  return s.length > 32 ? `${s.slice(0, 31)}…` : s;
}

/** The weekday each locale's week starts on: Saturday in Persian, Sunday in Hebrew and Arabic. */
function weekStart(locale: string): Date {
  if (locale === 'fa') return new Date(Date.UTC(2026, 0, 3, 12));
  if (locale === 'he' || locale === 'ar') return new Date(Date.UTC(2026, 0, 4, 12));
  return new Date(Date.UTC(2026, 0, 5, 12));
}

export function LiveWeek() {
  const t = useTranslations('home.v2.live');
  const ti = useTranslations('intake');
  const format = useFormatter();
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const { tick, restart } = useLoop(ref, LIVE_STEPS, 450);
  const [site, setSite] = useState('');

  /* The URL field in the hero sends what is typed (see url-intake.tsx); a
     pause in typing restarts the week for that address. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSite = (e: Event) => {
      const value = hostOf((e as CustomEvent<string>).detail ?? '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        setSite(value);
        restart();
      }, 500);
    };
    window.addEventListener('contivo:site', onSite);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('contivo:site', onSite);
    };
  }, [restart]);

  const done = tick === null;
  const chips = done ? FIELDS.length : Math.max(0, Math.min(FIELDS.length, tick - CHIPS_FROM + 1));
  const posts = done ? SLOTS.length : Math.max(0, Math.min(SLOTS.length, tick - POSTS_FROM + 1));
  const checked = done || tick >= CHECKED_AT;
  const reading = !done && tick < CHIPS_FROM + FIELDS.length;
  const start = weekStart(locale);
  const host = site || ti('placeholder');

  return (
    <figure ref={ref} className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={t('aria')}
        className="flex flex-col overflow-hidden rounded-2xl border-2 border-moss bg-chalk-raised"
      >
        {/* The address bar: the visitor's site, read live. */}
        <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
          <span
            aria-hidden
            className={cn(
              'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
              reading ? 'bg-saffron motion-safe:animate-pulse' : 'bg-moss',
            )}
          />
          <bdi dir="ltr" className="min-w-0 truncate font-plexmono text-[14px] text-moss">
            {host}
          </bdi>
          <span className="ms-auto shrink-0 font-plexmono text-[11px] uppercase tracking-[0.12em] text-moss-muted rtl:tracking-normal">
            {reading ? t('reading') : t('read')}
          </span>
        </div>

        {/* What it learned */}
        <ul className="flex flex-wrap gap-2 px-4 pt-4">
          {FIELDS.map((f, i) => {
            const on = i < chips;
            return (
              <li
                key={f}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-[13px] transition-colors duration-300',
                  on ? 'border-moss bg-moss text-chalk' : 'border-dashed border-rule-strong text-moss-muted',
                )}
              >
                <span className={cn('inline-block', on && tick !== null && 'motion-safe:animate-pop')}>{t(f)}</span>
              </li>
            );
          })}
        </ul>

        {/* The week it fills */}
        <div className="px-4 pb-4 pt-5">
          <p className="font-plexmono text-[11px] uppercase tracking-[0.12em] text-moss-muted rtl:tracking-normal">
            {t('week')}
          </p>
          <ol className="mt-2 grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: 7 }, (_, d) => {
              const day = new Date(start);
              day.setUTCDate(start.getUTCDate() + d);
              const slotIndex = SLOTS.findIndex((s) => s.day === d);
              const slot = slotIndex >= 0 ? SLOTS[slotIndex] : null;
              const shown = slot !== null && slotIndex < posts;
              return (
                <li key={d} className="flex flex-col items-center gap-1.5">
                  <div className="flex h-[76px] w-full items-end rounded-lg bg-chalk-sunk p-1">
                    {slot && (
                      <span
                        className={cn(
                          'relative flex h-[46px] w-full flex-col items-center justify-center gap-0.5 rounded-md border border-moss transition-[transform,opacity,background-color] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]',
                          checked ? 'bg-saffron' : 'bg-saffron-soft',
                          shown ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
                        )}
                      >
                        <ChannelMark channel={slot.channel} />
                        <span
                          aria-hidden
                          className={cn(
                            'text-[11px] font-bold leading-none text-moss transition-opacity duration-300',
                            checked ? 'opacity-100' : 'opacity-0',
                          )}
                        >
                          ✓
                        </span>
                      </span>
                    )}
                  </div>
                  <span className="font-plexmono text-[11px] text-moss-muted">
                    {format.dateTime(day, { weekday: 'narrow', timeZone: 'UTC' })}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule pt-3 text-[13px]">
            <p className={cn('font-semibold transition-opacity duration-300', checked ? 'opacity-100' : 'opacity-40')}>
              {t('summary', { count: SLOTS.length })}
            </p>
            <p className="flex items-center gap-3 text-moss-muted">
              <span className="flex items-center gap-1.5">
                <ChannelMark channel="linkedin" />
                LinkedIn
              </span>
              <span className="flex items-center gap-1.5">
                <ChannelMark channel="site" />
                {t('site')}
              </span>
            </p>
          </div>
        </div>
      </div>
      <figcaption className="text-[13px] leading-relaxed text-moss-muted">{t('caption')}</figcaption>
    </figure>
  );
}

function ChannelMark({ channel }: { channel: 'linkedin' | 'site' }) {
  if (channel === 'linkedin') {
    return (
      <span aria-hidden className="font-plexmono text-[11px] font-bold leading-none text-moss" dir="ltr">
        in
      </span>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 text-moss" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" />
    </svg>
  );
}

/* ─── GateDemo ───────────────────────────────────────────────────────────── */

/*
  The sample draft is product output, not interface copy, so it is written
  only in the two languages Contivo writes in: Persian on the Persian page,
  English everywhere else (and labelled as English there). Each language's
  flagged opener is one of that language's own tells in lib/humanize.ts.
*/
const SAMPLES = {
  en: {
    tell: 'In today’s fast-paced world,',
    stat: '73% of clinics',
    rest: 'lose a patient every week to a missed follow-up.',
    rewrite:
      'A missed follow-up costs more than the appointment it was meant to protect. Here is the two-line message that stops it happening.',
  },
  fa: {
    tell: 'در دنیای پرشتاب امروز،',
    stat: '۷۳ درصد کلینیک‌ها',
    rest: 'هر هفته یک بیمار را به خاطر یک پیگیریِ جاافتاده از دست می‌دهند.',
    rewrite: 'پیگیری‌ای که جا بیفتد، از خودِ نوبت گران‌تر تمام می‌شود. این پیامک دوخطی جلویش را می‌گیرد.',
  },
} as const;

const SCORES = [
  { key: 'brand', value: 8 },
  { key: 'safety', value: 9 },
  { key: 'clarity', value: 8 },
] as const;
const GATE_STEPS = 24; // 12s a cycle at 500ms
const TELL_AT = 2;
const STAT_AT = 4;
const HELD_AT = 6;
const REWRITE_AT = 10;
const PASSED_AT = 13;

export function GateDemo() {
  const t = useTranslations('home.v2.gate');
  const format = useFormatter();
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const { tick } = useLoop(ref, GATE_STEPS, 500);

  const lang = locale === 'fa' ? 'fa' : 'en';
  const sample = SAMPLES[lang];
  const animating = tick !== null;
  const at = (n: number) => !animating || tick >= n;
  /* Static (server, reduced motion): both halves, stacked. Animated: one card
     whose two halves cross-fade in the same grid cell, so nothing jumps. */
  const showRewrite = animating && tick >= REWRITE_AT;
  const when = format.dateTime(new Date(Date.UTC(2026, 0, 6, 9)), {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  const draft = (
    <Panel
      label={t('draftLabel')}
      faded={showRewrite}
      body={
        <>
          <Flag on={at(TELL_AT)}>{sample.tell}</Flag> <Flag on={at(STAT_AT)}>{sample.stat}</Flag> {sample.rest}
        </>
      }
      lang={lang}
      footer={
        <ul className="flex flex-col gap-2 text-[14px]">
          <Note on={at(TELL_AT)} text={t('tellNote')} />
          <Note on={at(STAT_AT)} text={t('statNote')} />
          <li
            className={cn(
              'mt-1 inline-flex w-fit items-center gap-2 rounded-full border border-saffron px-3 py-1 font-plexmono text-[12px] uppercase tracking-[0.1em] text-saffron transition-opacity duration-300 rtl:tracking-normal',
              at(HELD_AT) ? 'opacity-100' : 'opacity-0',
            )}
          >
            {t('held')}
          </li>
        </ul>
      }
    />
  );

  const rewrite = (
    <Panel
      label={t('rewriteLabel')}
      faded={animating && !showRewrite}
      body={sample.rewrite}
      lang={lang}
      footer={
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-3 gap-3">
            {SCORES.map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5">
                <dt className="text-[12px] leading-snug text-forest-muted">{t(`scores.${s.key}`)}</dt>
                <dd className="font-plexmono text-[15px]">
                  <bdi>{t('score', { score: format.number(s.value) })}</bdi>
                </dd>
                <span aria-hidden className="h-1 overflow-hidden rounded-full bg-forest-line">
                  <span
                    className="block h-full origin-left rounded-full bg-saffron transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)] rtl:origin-right"
                    style={{ transform: `scaleX(${!animating || showRewrite ? s.value / 10 : 0})` }}
                  />
                </span>
              </div>
            ))}
          </dl>
          <p
            className={cn(
              'inline-flex w-fit items-center gap-2 rounded-full bg-saffron px-3 py-1 text-[13px] font-semibold text-moss transition-opacity duration-300',
              at(PASSED_AT) ? 'opacity-100' : 'opacity-0',
            )}
          >
            {t('passed', { when })}
          </p>
        </div>
      }
    />
  );

  return (
    <figure ref={ref} className="flex flex-col gap-3">
      {/* Wraps: "illustration, draft in English" runs long in it/es/fr and
          pushed the page sideways at 320px when it could not shrink. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-[clamp(1.2rem,1.8vw,1.45rem)] font-bold">{t('title')}</p>
        <p className="font-plexmono text-[11px] uppercase tracking-[0.12em] text-forest-muted rtl:tracking-normal">
          {t(lang === 'en' && locale !== 'en' ? 'illustrationEnglish' : 'illustration')}
        </p>
      </div>
      {animating ? (
        <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
          {draft}
          {rewrite}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {draft}
          {rewrite}
        </div>
      )}
    </figure>
  );
}

function Panel({
  label,
  body,
  footer,
  faded,
  lang,
}: {
  label: string;
  body: ReactNode;
  footer: ReactNode;
  faded: boolean;
  lang: 'en' | 'fa';
}) {
  return (
    <div
      aria-hidden={faded || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-forest-line p-5 transition-opacity duration-300 md:p-6',
        /* One after the other, never both at once: the incoming panel waits
           for the outgoing one to finish fading. */
        faded ? 'pointer-events-none opacity-0' : 'opacity-100 delay-300',
      )}
    >
      <p className="font-plexmono text-[11px] uppercase tracking-[0.12em] text-forest-muted rtl:tracking-normal">{label}</p>
      <p lang={lang} dir={lang === 'fa' ? 'rtl' : 'ltr'} className="text-[clamp(1.05rem,1.5vw,1.2rem)] leading-[1.6]">
        {body}
      </p>
      {footer}
    </div>
  );
}

function Flag({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-sm decoration-saffron decoration-2 transition-colors duration-300',
        on ? 'bg-saffron/20 text-saffron-soft line-through' : '',
      )}
    >
      {children}
    </span>
  );
}

function Note({ on, text }: { on: boolean; text: string }) {
  return (
    <li className={cn('flex items-start gap-2 transition-opacity duration-300', on ? 'opacity-100' : 'opacity-0')}>
      <span aria-hidden className="mt-[0.45em] inline-block h-2 w-2 shrink-0 rotate-45 bg-saffron" />
      {text}
    </li>
  );
}

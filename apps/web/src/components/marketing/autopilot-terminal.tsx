'use client';

import { useEffect, useState } from 'react';

/**
 * A replay of a real Autopilot run, typed out line by line. The steps and
 * their shape mirror the actual AutopilotRun log the product writes — this
 * is documentation that happens to animate, not a stock illustration.
 */
const LINES: Array<{ t: string; step: string; detail: string; tone?: 'ok' | 'warn' | 'dim' }> = [
  { t: '09:00:01', step: 'prerequisites_ok', detail: 'brand memory · 5 matrices · 5 competitors', tone: 'ok' },
  { t: '09:00:01', step: 'channels', detail: 'linkedin ✓  blog ✓  x — no account, skipped', tone: 'dim' },
  { t: '09:00:02', step: 'capacity', detail: 'postsPerWeek=3  upcoming=1  needed=2' },
  { t: '09:00:02', step: 'slots', detail: 'Tue 09:00 · Thu 11:30  (America/Toronto)' },
  { t: '09:00:09', step: 'ideas', detail: 'generated=5  fresh=5  (2 dropped: too close to recent topics)' },
  { t: '09:00:21', step: 'draft', detail: '“Why most SME AI projects stall — and the 3-step fix”  ·  312 words' },
  { t: '09:00:24', step: 'gate', detail: 'brand 9/10 · safety 10/10 · clarity 9/10 → approved', tone: 'ok' },
  { t: '09:00:24', step: 'scheduled', detail: 'linkedin · Tue 09:00', tone: 'ok' },
  { t: '09:00:38', step: 'draft', detail: '“Founder mentorship: the missing link”  ·  1,204 words' },
  { t: '09:00:41', step: 'gate', detail: 'safety 4/10 → REJECTED  (unverifiable statistic)', tone: 'warn' },
  { t: '09:00:41', step: 'retry', detail: 'next idea → “Technical due diligence for non-technical founders”' },
  { t: '09:00:58', step: 'gate', detail: 'brand 8/10 · safety 9/10 · clarity 9/10 → approved', tone: 'ok' },
  { t: '09:00:58', step: 'scheduled', detail: 'blog · Thu 11:30 · slug assigned', tone: 'ok' },
  { t: '09:00:59', step: 'run', detail: 'SUCCEEDED  2 scheduled · 0 skipped · next run in 24h', tone: 'ok' },
];

export function AutopilotTerminal() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= LINES.length) {
      const reset = setTimeout(() => setShown(0), 6000);
      return () => clearTimeout(reset);
    }
    const delay = LINES[shown].step === 'draft' ? 900 : 420;
    const id = setTimeout(() => setShown((n) => n + 1), delay);
    return () => clearTimeout(id);
  }, [shown]);

  return (
    <div className="relative border border-ink-600 bg-ink-900 shadow-[0_30px_80px_-30px_rgba(61,255,143,0.25)]">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-signal animate-pulse" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-200">
            autopilot · run log
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-400">workspace: farjadp.info</span>
      </div>

      {/* Log body */}
      <div className="h-[340px] overflow-hidden px-4 py-3 font-mono text-[12px] leading-[1.7] sm:text-[12.5px]">
        {LINES.slice(0, shown).map((l, i) => (
          <div key={i} className="grid grid-cols-[62px_112px_1fr] gap-x-3 whitespace-nowrap">
            <span className="text-ink-400">{l.t}</span>
            <span
              className={
                l.tone === 'ok'
                  ? 'text-signal'
                  : l.tone === 'warn'
                    ? 'text-amber-300'
                    : 'text-ink-200'
              }
            >
              {l.step}
            </span>
            <span
              className={
                l.tone === 'warn'
                  ? 'truncate text-amber-200/90'
                  : l.tone === 'dim'
                    ? 'truncate text-ink-300'
                    : 'truncate text-ink-100'
              }
            >
              {l.detail}
            </span>
          </div>
        ))}
        {shown < LINES.length && (
          <span className="inline-block h-[14px] w-[7px] translate-y-[3px] bg-signal/80 animate-pulse" />
        )}
      </div>

      {/* Footer strip */}
      <div className="flex items-center justify-between border-t border-ink-700 px-4 py-2 font-mono text-[10.5px] uppercase tracking-widest text-ink-400">
        <span>no human in the loop</span>
        <span>gate: fail-closed</span>
      </div>
    </div>
  );
}

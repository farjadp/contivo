'use client';

/**
 * CompetitorConfirm.tsx
 *
 * The one decision before the first post (spec first-post B §4.1): tick at
 * least two real competitors. Nothing is ticked in advance except rows the
 * user accepted earlier; each tick is saved as the user's decision; a
 * competitor added by hand arrives ticked. With fewer than two suggestions
 * the add field is open and "Write my own instead" is offered.
 */

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';

import { startFirstPost } from '@/app/actions/first-post';
import { addManualCompetitor, setCompetitorDecision } from '@/app/actions/growth-competitors';
import type { FirstPostCompetitor } from '@/lib/first-post/types';

import { WriteOwnButton, aiTag, sourceTag } from './DraftCard';
import { primaryButton, quietLink } from './PublishPanel';
import {
  MIN_COMPETITORS,
  addTicked,
  canWriteFirstPost,
  evidenceLine,
  initialTicked,
  needsManualAdd,
  removeTicked,
} from './first-post-view-logic';

/** The run's expected length, as the concept states it ("about 2 minutes"). */
const RUN_MINUTES = 2;

export function CompetitorConfirm({
  workspaceId,
  competitors,
  headingId,
  onStarted,
}: {
  workspaceId: string;
  competitors: FirstPostCompetitor[];
  headingId: string;
  /** The run started (or one was already running): show its progress. */
  onStarted: () => void;
}) {
  const t = useTranslations('tabsA.firstPost.confirm');
  const few = needsManualAdd(competitors);

  const [rows, setRows] = useState<FirstPostCompetitor[]>(competitors);
  const [manualIds, setManualIds] = useState<ReadonlySet<string>>(new Set());
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => initialTicked(competitors));
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(few);
  const [domain, setDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);

  const toggle = async (id: string, on: boolean) => {
    setError(null);
    setTicked((prev) => (on ? addTicked(prev, id) : removeTicked(prev, id)));
    setSaving((n) => n + 1);
    try {
      const res = await setCompetitorDecision(workspaceId, id, on ? 'ACCEPTED' : 'PENDING');
      if ('error' in res) throw new Error(res.error);
    } catch {
      // Put the box back the way the server still has it.
      setTicked((prev) => (on ? removeTicked(prev, id) : addTicked(prev, id)));
      setError(t('saveFailed'));
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await addManualCompetitor(workspaceId, domain.trim());
      if ('error' in res) {
        setError(res.error);
        return;
      }
      const c = res.competitor;
      // addManualCompetitor saves the row as ACCEPTED: the user typed it.
      setRows((prev) => [...prev, { id: c.id, name: c.name, domain: c.domain, userDecision: 'ACCEPTED', evidence: c.evidence }]);
      setManualIds((prev) => addTicked(prev, c.id));
      setTicked((prev) => addTicked(prev, c.id));
      setDomain('');
      addInput.current?.focus();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setAdding(false);
    }
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await startFirstPost(workspaceId);
      if ('runId' in res) {
        onStarted();
        return;
      }
      setError(res.error);
    } catch {
      setError(t('saveFailed'));
    }
    setStarting(false);
  };

  const count = ticked.size;
  const enabled = canWriteFirstPost(count, saving) && !starting;

  return (
    <div className="max-w-3xl">
      <h2
        id={headingId}
        tabIndex={-1}
        className="font-display text-[26px] font-semibold leading-tight tracking-tight text-moss focus:outline-none sm:text-[32px]"
      >
        {few ? t('titleFew') : t('title')}
      </h2>
      <p className="mt-2 text-[15px] text-moss-muted">
        {few ? t('disclaimerFew', { min: MIN_COMPETITORS }) : t('disclaimer')}
      </p>

      {rows.length > 0 ? (
        <fieldset className="mt-6">
          <legend className="sr-only">{t('listLabel')}</legend>
          <ul>
            {rows.map((row) => {
              const line = evidenceLine(row.evidence);
              const checked = ticked.has(row.id);
              const inputId = `first-post-competitor-${row.id}`;
              return (
                <li key={row.id} className="border-t border-rule last:border-b">
                  <label htmlFor={inputId} className="flex cursor-pointer items-start gap-4 py-4">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(row.id, e.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-[1.5px] border-moss peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-moss ${
                        checked ? 'bg-moss text-saffron' : 'bg-transparent'
                      }`}
                    >
                      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span dir="auto" className="block font-semibold text-moss">
                        {row.name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-moss-muted">
                        {manualIds.has(row.id) ? (
                          <span className={sourceTag}>{t('addedByYou')}</span>
                        ) : line.kind === 'source' ? (
                          <>
                            <span className={sourceTag}>{t('sourceTag')}</span>
                            <bdi>{line.host}</bdi>
                          </>
                        ) : (
                          <span className={aiTag}>{t('aiGuess')}</span>
                        )}
                        {row.domain ? (
                          <span>
                            · <bdi>{row.domain}</bdi>
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      {addOpen ? (
        <form onSubmit={add} className="mt-6 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <label htmlFor="first-post-add" className="mb-1 block text-[13px] font-semibold text-moss">
              {t('addLabel')}
            </label>
            <input
              ref={addInput}
              id="first-post-add"
              type="text"
              inputMode="url"
              dir="ltr"
              autoComplete="off"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('addPlaceholder')}
              disabled={adding}
              className="block min-h-11 w-full rounded-lg border border-rule-strong bg-chalk-raised px-3 text-[15px] text-moss placeholder:text-moss-muted focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/20"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !domain.trim()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-moss px-4 text-[14.5px] font-semibold text-chalk hover:bg-moss-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('addSubmit')}
          </button>
          {!few ? (
            <button type="button" onClick={() => setAddOpen(false)} className={quietLink}>
              {t('addCancel')}
            </button>
          ) : null}
          {adding ? (
            <p role="status" className="basis-full text-[13px] text-moss-muted">
              {t('adding')}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={start}
          disabled={!enabled}
          aria-describedby="first-post-picked"
          className={`${primaryButton} px-6 py-3 text-[16px]`}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {starting ? t('starting') : t('start')}
        </button>
        <span id="first-post-picked" aria-live="polite" className="text-[13px] text-moss-muted">
          {count >= MIN_COMPETITORS
            ? t('picked', { count, minutes: RUN_MINUTES })
            : t('pickMore', { min: MIN_COMPETITORS })}
        </span>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
              // The field renders on the next commit.
              requestAnimationFrame(() => addInput.current?.focus());
            }}
            className={quietLink}
          >
            {t('add')}
          </button>
        ) : null}
        {few ? <WriteOwnButton workspaceId={workspaceId} label={t('writeOwn')} /> : null}
      </div>

      <p role="alert" className="mt-3 min-h-5 text-[13.5px] text-red-700">
        {error ?? ''}
      </p>
    </div>
  );
}

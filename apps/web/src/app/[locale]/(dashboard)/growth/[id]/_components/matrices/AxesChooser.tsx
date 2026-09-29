'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Loader2, Lock } from 'lucide-react';

import { saveMatrixAxes } from '@/app/actions/growth-matrices';
import { coreAxes, type StoredMarketAxis } from '@/lib/matrices/axes';
import { ErrorNote } from '../CompetitorBits';
import { MAX_AXES_SELECTED, canSubmitAxes, renameAxis, toggleAxis } from './matrix-run-logic';

/**
 * Spec §6.2. Two core axis pairs are always plotted; the run proposes market
 * pairs and the person picks up to three, renaming the labels if they like.
 * Keys and the low/high wording stay as proposed.
 */
export function AxesChooser({
  workspaceId,
  language,
  candidates,
  preselected,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  language: 'fa' | 'en';
  candidates: StoredMarketAxis[];
  /** Keys to start selected; falls back to the first two candidates. */
  preselected?: string[];
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations('tabsB.matrices.axes');
  const format = useFormatter();
  const maxText = format.number(MAX_AXES_SELECTED);
  const core = useMemo(() => coreAxes(language), [language]);

  const [axes, setAxes] = useState<StoredMarketAxis[]>(candidates);
  const [selected, setSelected] = useState<string[]>(() => {
    const keys = new Set(candidates.map((axis) => axis.key));
    const kept = (preselected ?? []).filter((key) => keys.has(key)).slice(0, MAX_AXES_SELECTED);
    return kept.length > 0 ? kept : candidates.slice(0, 2).map((axis) => axis.key);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = axes.filter((axis) => selected.includes(axis.key));
  const labelsFilled = chosen.every((axis) => axis.x.label.trim() !== '' && axis.y.label.trim() !== '');
  const atMax = selected.length >= MAX_AXES_SELECTED;
  const canSubmit = canSubmitAxes(selected) && labelsFilled && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const payload = chosen.map((axis) => ({
        ...axis,
        x: { ...axis.x, label: axis.x.label.trim() },
        y: { ...axis.y, label: axis.y.label.trim() },
      }));
      const result = await saveMatrixAxes(workspaceId, payload);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      await onSaved();
    } catch (saveError) {
      console.error(saveError);
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 rounded-2xl border border-rule bg-chalk-raised p-5">
      <div>
        <h3 className="text-base font-bold tracking-tight text-moss">{t('title')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-moss-muted">{t('intro', { max: maxText })}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-moss-muted">{t('coreTitle')}</p>
        <ul className="flex flex-wrap gap-2">
          {core.map((axis) => (
            <li
              key={axis.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-chalk-sunk px-3 py-1 text-xs font-semibold text-moss"
            >
              <Lock aria-hidden className="h-3 w-3 shrink-0 text-moss-muted" />
              <bdi>{axis.name}</bdi>
              <span className="sr-only">{t('locked')}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-moss-muted">{t('candidatesTitle')}</p>
          <p className="text-xs text-moss-muted" aria-live="polite">
            {t('selectedCount', { count: format.number(selected.length), max: maxText })}
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {axes.map((axis) => {
            const isOn = selected.includes(axis.key);
            const blocked = !isOn && atMax;
            return (
              <li
                key={axis.key}
                className={`space-y-3 rounded-xl border p-4 ${isOn ? 'border-moss bg-chalk' : 'border-rule bg-chalk-raised'}`}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  disabled={blocked}
                  onClick={() => setSelected((prev) => toggleAxis(prev, axis.key))}
                  className="flex min-h-10 w-full items-center gap-2 text-start text-sm font-semibold text-moss disabled:cursor-not-allowed disabled:text-moss-muted"
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      isOn ? 'border-moss bg-moss text-chalk' : 'border-rule-strong bg-chalk-raised'
                    }`}
                  >
                    {isOn ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <bdi>
                    {axis.x.label} / {axis.y.label}
                  </bdi>
                </button>
                <p className="text-xs leading-relaxed text-moss-muted" dir="auto">
                  {axis.rationale}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold text-moss-muted">{t('labelX')}</span>
                    <input
                      type="text"
                      dir="auto"
                      value={axis.x.label}
                      maxLength={60}
                      onChange={(event) =>
                        setAxes((prev) => renameAxis(prev, axis.key, { x: event.target.value, y: axis.y.label }))
                      }
                      className="w-full rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-sm text-moss focus:border-moss focus:outline-none focus:ring-2 focus:ring-rule"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold text-moss-muted">{t('labelY')}</span>
                    <input
                      type="text"
                      dir="auto"
                      value={axis.y.label}
                      maxLength={60}
                      onChange={(event) =>
                        setAxes((prev) => renameAxis(prev, axis.key, { x: axis.x.label, y: event.target.value }))
                      }
                      className="w-full rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-sm text-moss focus:border-moss focus:outline-none focus:ring-2 focus:ring-rule"
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        {atMax ? <p className="text-xs text-moss-muted">{t('maxReached', { max: maxText })}</p> : null}
        {selected.length === 0 ? <p className="text-xs text-saffron-ink">{t('chooseOne')}</p> : null}
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-moss px-5 py-2 text-[13px] font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-50"
        >
          {saving ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {t('submit')}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex min-h-10 items-center rounded-lg border border-rule bg-chalk-raised px-4 py-2 text-[13px] font-bold text-moss transition hover:border-rule-strong hover:bg-chalk disabled:opacity-50"
          >
            {t('cancel')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Circle, Loader2, Sparkles } from 'lucide-react';

import { updateTargetMarket } from '@/app/actions/growth-competitors';
import type { DiscoveryMeta, RunView } from '@/app/actions/growth-competitors';
import { ErrorNote, WarningNote } from './CompetitorBits';
import { STAGE_ORDER, displayName, runOutcome, stageIndex } from './competitor-discovery-logic';

export type TargetMarketView = { country: string | null; language: 'fa' | 'en' };

/**
 * Countries offered in the market picker. There is no canonical list in
 * this codebase (the server only checks the ISO-3166 alpha-2 shape), so
 * this is a short list of the markets Contivo's users actually work in,
 * plus whatever the workspace already has saved.
 */
const COUNTRY_CHOICES = ['IR', 'US', 'CA', 'GB', 'DE', 'FR', 'NL', 'SE', 'TR', 'AE', 'AU', 'IN'];

export function CompetitorDiscoveryPanel({
  workspaceId,
  meta,
  run,
  market,
  starting,
  startError,
  pollStopped,
  pendingCount,
  onStart,
  onMarketSaved,
  onAddManual,
}: {
  workspaceId: string;
  meta: DiscoveryMeta;
  run: RunView | null;
  market: TargetMarketView;
  starting: boolean;
  startError: string | null;
  pollStopped: boolean;
  pendingCount: number;
  onStart: () => void;
  onMarketSaved: (market: TargetMarketView) => void;
  onAddManual: () => void;
}) {
  const t = useTranslations('growth.competitors');
  const locale = useLocale();

  const outcome = runOutcome(run);
  const active = outcome.kind === 'active';
  const quotaSpent = meta.remainingRuns <= 0;

  const [editing, setEditing] = useState(false);
  const [draftCountry, setDraftCountry] = useState<string>(market.country ?? '');
  const [draftLanguage, setDraftLanguage] = useState<'fa' | 'en'>(market.language);
  const [savingMarket, setSavingMarket] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);

  const countryName = market.country ? displayName(locale, 'region', market.country) : t('market.everywhere');
  const languageName = displayName(locale, 'language', market.language);
  // What an EMPTY result says was searched comes from the run's own market
  // snapshot, not the workspace's current market, which may have changed
  // since. Only a run too old to carry a snapshot falls back to the current one.
  const searchedMarket = (outcome.kind === 'empty' ? outcome.market : null) ?? market;
  const runCountryName = searchedMarket.country
    ? displayName(locale, 'region', searchedMarket.country)
    : t('market.everywhere');
  const runLanguageName = displayName(locale, 'language', searchedMarket.language);

  const countryOptions = useMemo(() => {
    const codes = new Set(COUNTRY_CHOICES);
    if (market.country) codes.add(market.country);
    return [...codes]
      .map((code) => ({ code, name: displayName(locale, 'region', code) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale, market.country]);

  const openEditor = () => {
    setDraftCountry(market.country ?? '');
    setDraftLanguage(market.language);
    setMarketError(null);
    setEditing(true);
  };

  const saveMarket = async () => {
    const country = draftCountry || null;
    setSavingMarket(true);
    setMarketError(null);
    try {
      const result = await updateTargetMarket(workspaceId, country, draftLanguage);
      if ('error' in result) {
        setMarketError(result.error);
        return;
      }
      onMarketSaved({ country, language: draftLanguage });
      setEditing(false);
    } catch (error) {
      console.error(error);
      setMarketError(t('market.saveFailed'));
    } finally {
      setSavingMarket(false);
    }
  };

  const currentStage = outcome.kind === 'active' ? stageIndex(outcome.stage) : -1;

  return (
    <div className="space-y-4 rounded-2xl border border-rule bg-chalk p-4 sm:p-5">
      {/* Market line and its inline editor */}
      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-moss-muted">
              <span>{t('market.countryLabel')}</span>
              <select
                value={draftCountry}
                onChange={(event) => setDraftCountry(event.target.value)}
                className="w-full rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-sm font-normal text-moss focus:border-moss focus:outline-none"
              >
                <option value="">{t('market.everywhere')}</option>
                {countryOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-moss-muted">
              <span>{t('market.languageLabel')}</span>
              <select
                value={draftLanguage}
                onChange={(event) => setDraftLanguage(event.target.value === 'fa' ? 'fa' : 'en')}
                className="w-full rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-sm font-normal text-moss focus:border-moss focus:outline-none"
              >
                <option value="fa">{displayName(locale, 'language', 'fa')}</option>
                <option value="en">{displayName(locale, 'language', 'en')}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveMarket}
              disabled={savingMarket}
              className="inline-flex items-center gap-2 rounded-lg bg-moss px-4 py-2 text-sm font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-60"
            >
              {savingMarket ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
              {t('market.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={savingMarket}
              className="rounded-lg border border-rule-strong bg-chalk-raised px-4 py-2 text-sm font-semibold text-moss transition hover:bg-chalk-sunk disabled:opacity-60"
            >
              {t('market.cancel')}
            </button>
          </div>
          {marketError ? <ErrorNote>{marketError}</ErrorNote> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-moss">
            {t('market.searchingIn', { country: countryName, language: languageName })}
          </p>
          {active ? (
            <span className="text-xs text-moss-muted">{t('market.lockedWhileRunning')}</span>
          ) : (
            <button
              type="button"
              onClick={openEditor}
              className="text-sm font-semibold text-moss-700 underline decoration-rule-strong underline-offset-2 hover:decoration-moss"
            >
              {t('market.change')}
            </button>
          )}
        </div>
      )}

      {/* Find button and quota */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={active || starting || quotaSpent}
          className="inline-flex items-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-sm font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-60"
        >
          {active || starting ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="h-4 w-4 text-saffron" />
          )}
          {t('run.find')}
        </button>
        <span className="text-xs font-semibold text-moss-700">
          {quotaSpent
            ? t('run.quotaSpent', { max: meta.maxRuns })
            : t('run.quota', { remaining: meta.remainingRuns, max: meta.maxRuns })}
        </span>
        {!quotaSpent ? <span className="text-xs text-moss-muted">{t('run.onlyDoneCounts')}</span> : null}
      </div>

      {startError ? <ErrorNote>{startError}</ErrorNote> : null}

      {/* Live progress */}
      {outcome.kind === 'active' ? (
        <div className="space-y-3 border-t border-rule pt-4" aria-live="polite">
          <ol className="space-y-2">
            {STAGE_ORDER.map((stage, index) => {
              const state = index < currentStage ? 'done' : index === currentStage ? 'current' : 'upcoming';
              return (
                <li
                  key={stage}
                  className={`flex items-center gap-2 text-sm ${
                    state === 'current' ? 'font-semibold text-moss' : state === 'done' ? 'text-moss-700' : 'text-moss-muted'
                  }`}
                >
                  {state === 'done' ? (
                    <Check aria-hidden className="h-4 w-4 shrink-0 text-moss-700" />
                  ) : state === 'current' ? (
                    <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-saffron-ink" />
                  ) : (
                    <Circle aria-hidden className="h-4 w-4 shrink-0 text-rule-strong" />
                  )}
                  <span>{t(`run.stages.${stage}`)}</span>
                  {state !== 'upcoming' ? (
                    <span className="sr-only">
                      {state === 'done' ? t('run.stageDone') : t('run.stageCurrent')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {currentStage < 0 ? <p className="text-sm text-moss-muted">{t('run.starting')}</p> : null}
          {outcome.queries.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-moss-muted">{t('run.queriesTitle')}</p>
              <ul className="flex flex-wrap gap-2">
                {outcome.queries.map((query, index) => (
                  <li
                    key={`${index}-${query}`}
                    dir="auto"
                    className="rounded-full border border-rule bg-chalk-raised px-2.5 py-0.5 text-xs text-moss"
                  >
                    {query}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-moss-muted">{t('run.leaveNote')}</p>
          {pollStopped ? <WarningNote>{t('run.pollStopped')}</WarningNote> : null}
        </div>
      ) : null}

      {outcome.kind === 'done' && pendingCount > 0 ? (
        <div className="space-y-1 border-t border-rule pt-4 text-sm text-moss">
          <p>{t('run.done', { count: outcome.saved })}</p>
          {outcome.skippedSites > 0 ? (
            <p className="text-xs text-moss-muted">{t('run.skippedSites', { count: outcome.skippedSites })}</p>
          ) : null}
        </div>
      ) : null}

      {outcome.kind === 'empty' ? (
        <div className="space-y-3 border-t border-rule pt-4">
          <p className="text-sm font-bold text-moss">{t('run.emptyTitle')}</p>
          <p className="text-sm text-moss">
            {outcome.queryCount != null
              ? t('run.emptyDetail', { count: outcome.queryCount, country: runCountryName, language: runLanguageName })
              : t('run.emptyDetailNoCount', { country: runCountryName, language: runLanguageName })}
          </p>
          {outcome.skippedSites > 0 ? (
            <p className="text-xs text-moss-muted">{t('run.skippedSites', { count: outcome.skippedSites })}</p>
          ) : null}
          <p className="text-xs font-semibold text-moss-700">{t('run.notCharged')}</p>
          <p className="text-sm text-moss-muted">{t('run.nextStepsIntro')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openEditor}
              className="rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-sm font-semibold text-moss transition hover:bg-chalk-sunk"
            >
              {t('run.nextChangeMarket')}
            </button>
            <button
              type="button"
              onClick={onAddManual}
              className="rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-start text-sm font-semibold text-moss transition hover:bg-chalk-sunk"
            >
              {t('run.nextAddManual')}
              <span className="block text-xs font-normal text-moss-muted">{t('run.nextAddManualHint')}</span>
            </button>
          </div>
        </div>
      ) : null}

      {outcome.kind === 'failed' ? (
        <div className="space-y-2 border-t border-rule pt-4" role="alert">
          <p className="text-sm font-bold text-red-700">{t('run.failedTitle')}</p>
          <p className="text-sm text-moss">{t('run.failedNotCharged')}</p>
          {outcome.error ? (
            <p className="text-xs text-moss-muted">
              {t('run.failedDetail')}{' '}
              <span dir="auto" className="break-words">
                {outcome.error}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

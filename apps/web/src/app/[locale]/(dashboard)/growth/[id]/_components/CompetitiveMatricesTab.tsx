'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

import {
  getMatrixStatus,
  startMatrixRun,
  type MatrixRunView,
  type MatrixStatus,
} from '@/app/actions/growth-matrices';
import { useRouter } from '@/i18n/navigation';
import type { StoredMarketAxis } from '@/lib/matrices/axes';
import { CompetitorMapManager } from './CompetitorMapManager';
import { AxesChooser } from './matrices/AxesChooser';
import { MatrixRunHeader } from './matrices/MatrixRunHeader';
import { POLL_INTERVAL_MS, isMatrixRunActive, refusalDuplicatesRun, shouldKeepPolling } from './matrices/matrix-run-logic';

type MatrixCompanyPoint = {
  name: string;
  website: string;
  type: 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL' | 'TARGET';
  x_score: number;
  y_score: number;
  x_reason: string;
  y_reason: string;
  confidence_score: number;
};

type CompetitiveMatrixChart = {
  chart_key: string;
  chart_name: string;
  axes: {
    x: string;
    y: string;
  };
  companies: MatrixCompanyPoint[];
  summary: {
    market_pattern: string;
    positioning_opportunity: string;
  };
};

type CompetitiveMatrixPayload = {
  generated_at: string;
  /** Which competitors the result was built on; absent on payloads older than that rule. */
  competitor_basis?: 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE';
  ai_estimated: boolean;
  source: 'AI' | 'MANUAL';
  charts: CompetitiveMatrixChart[];
  cross_chart_summary: string;
  strongest_differentiation_opportunity: string;
  token_usage: {
    runs: number;
    lifetime_prompt_tokens: number;
    lifetime_completion_tokens: number;
    lifetime_total_tokens: number;
    last_run: {
      model: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      created_at: string;
    } | null;
  };
};

type DiscoveryMeta = {
  usedRuns: number;
  remainingRuns: number;
  maxRuns: number;
};

type DiscoveryArchiveItem = {
  id: string;
  runNumber: number;
  source: string;
  discoveredCount: number;
  createdAt: string | Date;
};

function colorForType(type: MatrixCompanyPoint['type']): string {
  // You are saffron; every rival is rival blue, told apart by fill rather
  // than hue so the three kinds survive greyscale and colour blindness.
  if (type === 'TARGET') return 'bg-saffron border-moss text-moss';
  if (type === 'INDIRECT') return 'bg-chalk-raised border-rival text-rival';
  if (type === 'ASPIRATIONAL') return 'bg-moss-700 border-moss-700 text-chalk';
  return 'bg-rival border-rival text-chalk';
}

function textColorForType(type: MatrixCompanyPoint['type']): string {
  if (type === 'TARGET') return 'text-moss';
  if (type === 'INDIRECT') return 'text-rival';
  if (type === 'ASPIRATIONAL') return 'text-moss-700';
  return 'text-rival';
}

function legendKeyForType(type: MatrixCompanyPoint['type']): string {
  if (type === 'TARGET') return 'target';
  if (type === 'INDIRECT') return 'indirect';
  if (type === 'ASPIRATIONAL') return 'aspirational';
  return 'direct';
}

function compactDomain(website: string): string {
  return website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function scoreToPercent(score: number): number {
  const safe = Math.max(1, Math.min(10, score));
  return 10 + ((safe - 1) / 9) * 80;
}

/** Proposed axes first, then any saved axis the proposal no longer lists. */
function mergeAxisOptions(candidates: StoredMarketAxis[], saved: StoredMarketAxis[]): StoredMarketAxis[] {
  const keys = new Set(candidates.map((axis) => axis.key));
  return [...candidates, ...saved.filter((axis) => !keys.has(axis.key))];
}

export function CompetitiveMatricesTab({
  workspaceId,
  initialMatrices,
  targetMarket,
  discoveryMeta,
  discoveryArchive,
}: {
  workspaceId: string;
  initialMatrices: CompetitiveMatrixPayload | null;
  targetMarket: { country: string | null; language: 'fa' | 'en' };
  discoveryMeta: DiscoveryMeta;
  discoveryArchive: DiscoveryArchiveItem[];
}) {
  const t = useTranslations('tabsB.matrices');
  const format = useFormatter();
  const [matrices, setMatrices] = useState<CompetitiveMatrixPayload | null>(initialMatrices);
  const [selectedKey, setSelectedKey] = useState<string>(
    initialMatrices?.charts?.[0]?.chart_key || 'price_value_depth',
  );
  // UI toggles for reducing clutter
  const [showTokens, setShowTokens] = useState(false);
  const [showAxes, setShowAxes] = useState(false);

  const router = useRouter();
  // Read through a ref inside the poll callback so a router object that
  // changes identity between renders never restarts the interval.
  const routerRef = useRef(router);
  routerRef.current = router;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The page renders from `initialMatrices`; the run state below is fetched
  // once on mount and polled only while a run is active.
  const [status, setStatus] = useState<MatrixStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);
  const runRef = useRef<MatrixRunView | null>(null);

  // A router.refresh() re-renders the server page with the new saved result.
  useEffect(() => {
    setMatrices(initialMatrices);
  }, [initialMatrices]);

  const selectedChart = useMemo(
    () => matrices?.charts.find((chart) => chart.chart_key === selectedKey) || null,
    [matrices, selectedKey],
  );

  const applyStatus = useCallback((next: MatrixStatus) => {
    const wasActive = isMatrixRunActive(runRef.current?.status);
    runRef.current = next.run;
    setStatus(next);
    if (wasActive && !isMatrixRunActive(next.run?.status)) {
      // A run just finished while this page was watching it.
      routerRef.current.refresh();
    }
  }, []);

  /** Fetches and applies the status. Returns false when the request was refused. */
  const fetchStatus = useCallback(async (): Promise<boolean> => {
    const next = await getMatrixStatus(workspaceId);
    if (!mountedRef.current) return true;
    if ('error' in next) return false;
    applyStatus(next);
    return true;
  }, [workspaceId, applyStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await fetchStatus();
        if (!cancelled) setLoadState(ok ? 'ready' : 'error');
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  // Poll only while the latest run is PENDING or RUNNING.
  const runActive = isMatrixRunActive(status?.run?.status);
  const runId = status?.run?.id;
  useEffect(() => {
    if (!runActive) return;
    setPollStopped(false);
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      if (!shouldKeepPolling(runRef.current, Date.now())) {
        window.clearInterval(timer);
        if (!cancelled) setPollStopped(true);
        return;
      }
      inFlight = true;
      try {
        if (cancelled) return;
        const ok = await fetchStatus();
        if (!ok) {
          window.clearInterval(timer);
          if (!cancelled) setPollStopped(true);
        }
      } catch (pollError) {
        // One failed poll is not the end of the run; the next tick retries.
        console.error(pollError);
      } finally {
        inFlight = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runActive, runId, fetchStatus]);

  const startRun = async () => {
    setStarting(true);
    setStartError(null);
    setShowAxes(false);
    const runIdBeforeStart = runRef.current?.id ?? null;
    try {
      const started = await startMatrixRun(workspaceId);
      if ('error' in started) {
        setStartError(started.error);
        // A dispatch failure leaves a FAILED run behind; show it, and drop the
        // message only if it repeats that new run's failure.
        await fetchStatus().catch((refreshError) => console.error(refreshError));
        if (mountedRef.current && refusalDuplicatesRun(runRef.current, runIdBeforeStart)) setStartError(null);
        return;
      }
      if (!(await fetchStatus())) setPollStopped(true);
    } catch (startFailure) {
      console.error(startFailure);
      if (mountedRef.current) setStartError(t('generateFailed'));
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const onAxesSaved = async () => {
    setShowAxes(false);
    setStartError(null);
    try {
      if (!(await fetchStatus())) setPollStopped(true);
    } catch (refreshError) {
      console.error(refreshError);
    }
  };

  const run = status?.run ?? null;
  const needsAxes = run?.status === 'NEEDS_AXES';
  const axisOptions = needsAxes
    ? run.axisCandidates
    : mergeAxisOptions(run?.axisCandidates ?? [], status?.savedAxes ?? []);
  const chooserOpen = (needsAxes || showAxes) && axisOptions.length > 0;
  const hasAxesToEdit = !needsAxes && axisOptions.length > 0;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-12 w-full max-w-[1500px] mx-auto">
      {/* 1. Competitors Management Area */}
      <section id="matrices-competitors" className="relative overflow-hidden rounded-[2rem] border border-rule bg-chalk-raised shadow-sm">
        <div className="bg-gradient-to-r from-chalk/50 to-chalk-raised px-6 py-5 border-b border-rule flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-moss tracking-tight">{t('landscapeTitle')}</h2>
            <p className="text-[13px] text-moss-muted mt-1 max-w-2xl">{t('landscapeSubtitle')}</p>
          </div>
        </div>
        <div className="p-6 bg-chalk-raised">
          <CompetitorMapManager
            workspaceId={workspaceId}
            initialMeta={discoveryMeta}
            initialArchive={discoveryArchive}
            initialMarket={targetMarket}
          />
        </div>
      </section>

      {/* 2. Market Matrices Area */}
      <section className="relative overflow-visible rounded-3xl border border-rule bg-chalk-raised shadow-sm flex flex-col min-h-[600px]">
        {/* Header toolbar */}
        <div className="bg-chalk-raised px-6 py-5 border-b border-rule flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-moss tracking-tight">{t('title')}</h2>
              <span className="rounded-full bg-chalk-sunk px-2.5 py-0.5 text-[10px] font-bold text-moss uppercase tracking-widest ring-1 ring-rule">
                {t('aiBadge')}
              </span>
            </div>
            <p className="max-w-xl text-[13px] text-moss-muted mt-1">
              {t('subtitle', { count: format.number(matrices?.charts.length || 5) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {matrices?.token_usage && (
              <button
                type="button"
                onClick={() => setShowTokens(!showTokens)}
                className="inline-flex min-h-10 items-center rounded-lg bg-chalk-raised border border-rule px-4 py-2 text-[13px] font-bold text-moss transition hover:bg-chalk hover:border-rule-strong"
              >
                {showTokens ? t('hideDiagnostics') : t('viewDiagnostics')}
              </button>
            )}
          </div>
        </div>

        <div className="border-b border-rule px-6 py-4">
          <MatrixRunHeader
            workspaceId={workspaceId}
            status={status}
            loadState={loadState}
            matrices={matrices}
            starting={starting}
            startError={startError}
            pollStopped={pollStopped}
            hasAxesToEdit={hasAxesToEdit}
            onStart={startRun}
            onOpenAxes={() => setShowAxes(true)}
          />
        </div>

        {chooserOpen ? (
          <div className="border-b border-rule px-6 py-5">
            <AxesChooser
              key={run?.id ?? 'axes'}
              workspaceId={workspaceId}
              language={targetMarket.language}
              candidates={axisOptions}
              preselected={needsAxes ? undefined : status?.savedAxes.map((axis) => axis.key)}
              onSaved={onAxesSaved}
              onCancel={needsAxes ? undefined : () => setShowAxes(false)}
            />
          </div>
        ) : null}

        {/* Global Notifications / Status */}
        {showTokens && (
          <div className="px-6 py-4 border-b border-rule bg-chalk/30 space-y-3">
            {showTokens && matrices?.token_usage && (
              <div className="grid gap-4 pt-2 md:grid-cols-2">
                <div className="rounded-2xl bg-chalk-raised p-5 border border-rule shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-moss-700 mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-moss"></span>{t('lastRunData')}
                  </p>
                  {matrices.token_usage.last_run ? (
                    <div className="space-y-3 text-[13px] text-moss">
                      <div className="flex justify-between items-center border-b border-rule pb-2">
                        <span className="text-moss-muted">{t('promptTokens')}</span>
                        <span className="font-bold text-moss text-[14px]">{format.number(matrices.token_usage.last_run.prompt_tokens)}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-rule pb-2">
                        <span className="text-moss-muted">{t('completionTokens')}</span>
                        <span className="font-bold text-moss text-[14px]">{format.number(matrices.token_usage.last_run.completion_tokens)}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <span className="text-moss font-bold">{t('totalTokens')}</span>
                        <span className="font-black text-moss text-[15px]">{format.number(matrices.token_usage.last_run.total_tokens)}</span>
                      </div>
                      <div className="text-[11px] text-moss-muted pt-3 mt-1 text-end">
                        {t.rich('modelLine', {
                          model: matrices.token_usage.last_run.model,
                          date: format.dateTime(new Date(matrices.token_usage.last_run.created_at), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                          m: (chunks) => <bdi>{chunks}</bdi>,
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-moss-muted">{t('noTokenData')}</p>
                  )}
                </div>

                <div className="rounded-2xl bg-chalk-raised p-5 border border-rule shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-moss-700 mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-saffron"></span>{t('lifetimeUsage')}
                  </p>
                  <div className="space-y-3 text-[13px] text-moss">
                    <div className="flex justify-between items-center border-b border-rule pb-2">
                      <span className="text-moss-muted">{t('totalRuns')}</span>
                      <span className="font-bold text-moss text-[14px]">{format.number(matrices.token_usage.runs)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-rule pb-2">
                      <span className="text-moss-muted">{t('accumulatedPrompts')}</span>
                      <span className="font-bold text-moss text-[14px]">{format.number(matrices.token_usage.lifetime_prompt_tokens)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-rule pb-2">
                      <span className="text-moss-muted">{t('accumulatedCompletions')}</span>
                      <span className="font-bold text-moss text-[14px]">{format.number(matrices.token_usage.lifetime_completion_tokens)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-moss font-bold">{t('lifetimeTotal')}</span>
                      <span className="font-black text-moss-700 text-[15px]">{format.number(matrices.token_usage.lifetime_total_tokens)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dashboard Split View */}
        <div className="flex flex-col lg:flex-row flex-1 bg-chalk-raised">
          {!matrices || matrices.charts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-16 text-center text-moss-muted bg-chalk/30">
              <div className="w-20 h-20 rounded-full bg-chalk-raised flex items-center justify-center mb-5 border border-rule shadow-sm">
                <Sparkles className="h-8 w-8 text-moss-muted" />
              </div>
              <p className="text-lg font-bold text-moss mb-2 tracking-tight">{t('emptyTitle')}</p>
              <p className="text-[14px] max-w-sm leading-relaxed">{t('emptyBody')}</p>
            </div>
          ) : (
            <>
              {/* Sidebar: Navigation & Macro Summary */}
              <div className="w-full lg:w-[280px] xl:w-[310px] shrink-0 border-e border-rule bg-chalk/60 flex flex-col">
                <div className="p-5 space-y-2">
                  <h4 className="px-2 pb-3 text-[10px] font-bold uppercase tracking-widest text-moss-muted">
                    {t('dimensions')}
                  </h4>
                  {matrices.charts.map((chart: any) => (
                    <button
                      key={chart.chart_key}
                      type="button"
                      onClick={() => setSelectedKey(chart.chart_key)}
                      className={`w-full text-start rounded-lg px-4 py-3 text-[13px] font-bold transition-all duration-200 ${
                        selectedKey === chart.chart_key
                          ? 'bg-chalk-raised text-moss shadow-sm ring-1 ring-rule'
                          : 'text-moss-muted hover:bg-chalk-raised hover:text-moss'
                      }`}
                    >
                      {chart.chart_name}
                    </button>
                  ))}
                </div>

                <div className="mt-auto p-5 border-t border-rule space-y-5 bg-chalk-raised shrink-0">
                  <div className="space-y-3">
                    <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-moss-700">
                      <div className="h-2 w-2 rounded-full bg-moss"></div>
                      {t('macroOpportunity')}
                    </h4>
                    <p className="text-[13px] font-semibold tracking-tight text-moss bg-chalk-sunk/80 rounded-xl p-4 leading-relaxed border border-rule">
                      {matrices.strongest_differentiation_opportunity}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-moss-muted">
                      <div className="h-2 w-2 rounded-full border-2 border-rule-strong bg-chalk-raised"></div>
                      {t('crossChart')}
                    </h4>
                    <p className="text-[13px] text-moss leading-relaxed ps-4 border-s-[3px] border-rule max-h-64 overflow-y-auto pe-2">
                      {matrices.cross_chart_summary}
                    </p>
                  </div>
                </div>
              </div>

              {/* Main Area: Chart Visualization */}
              <div className="flex-1 flex flex-col bg-chalk-raised overflow-visible">
                {selectedChart && (
                  <div className="p-5 md:p-7 flex flex-col h-full w-full mx-auto max-w-[1280px]">
                    <div className="mb-6 flex flex-col gap-3 border-b border-rule pb-5 lg:flex-row lg:items-end lg:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-2xl md:text-3xl font-black text-moss tracking-tight">
                          {selectedChart.chart_name}
                        </h3>
                        <p className="text-[13px] text-moss-muted mt-2 font-medium">
                          {t.rich('axesVs', {
                            x: selectedChart.axes.x,
                            y: selectedChart.axes.y,
                            /* Axis names come back from the model in English
                               and are data, not copy: isolated, not flipped. */
                            b: (chunks) => (
                              <span className="font-bold text-moss">
                                <bdi>{chunks}</bdi>
                              </span>
                            ),
                          })}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] font-bold text-moss-muted">
                        {(['TARGET', 'DIRECT', 'INDIRECT', 'ASPIRATIONAL'] as const).map((type) => (
                          <span
                            key={type}
                            className="inline-flex items-center gap-2 rounded-full border border-rule bg-chalk-raised px-3 py-1 text-moss"
                          >
                            <span className={`h-3 w-3 rounded-full border ${colorForType(type)}`} />
                            {t(`legend.${type.toLowerCase()}` as 'legend.target')}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-5">
                        {/* The Chart Container */}
                        {/*
                          The plot is laid out in percentages off the physical
                          left and top edges, the way a scatter chart is: the
                          x axis runs low-to-high left-to-right in either
                          language, so mirroring it would move every point
                          without moving its meaning. Same call the admin
                          console's Recharts wrappers make. Only the frame is
                          pinned; the labels inside are translated and the
                          tooltip text under them is set back to inherit.
                        */}
                        <div
                          dir="ltr"
                          className="relative h-[520px] w-full rounded-2xl border border-rule bg-chalk-raised shadow-inner"
                        >
                          <div className="absolute inset-8 rounded-xl bg-gradient-to-tr from-chalk to-chalk-raised">
                            <div className="absolute inset-x-0 top-1/2 h-px bg-chalk-sunk/80 -translate-y-1/2"></div>
                            <div className="absolute inset-y-0 left-1/2 w-px bg-chalk-sunk/80 -translate-x-1/2"></div>
                            <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-rule"></div>
                          </div>

                          <span className="absolute left-5 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold uppercase tracking-widest text-moss-muted whitespace-nowrap">
                            <bdi>{selectedChart.axes.y}</bdi>
                          </span>
                          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-moss-muted whitespace-nowrap">
                            <bdi>{selectedChart.axes.x}</bdi>
                          </span>
                          <span className="absolute left-10 top-8 text-[10px] font-bold uppercase tracking-widest text-moss-muted">
                            {t('high')}
                          </span>
                          <span className="absolute bottom-8 right-10 text-[10px] font-bold uppercase tracking-widest text-moss-muted">
                            {t('high')}
                          </span>

                          {selectedChart.companies.map((company, index) => {
                            const x = scoreToPercent(company.x_score);
                            const y = 100 - scoreToPercent(company.y_score);
                            const isTarget = company.type === 'TARGET';
                            return (
                              <div
                                key={`${selectedChart.chart_key}:${company.name}:${company.website}`}
                                className="group absolute z-10"
                                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                              >
                                <div
                                  className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 text-[10px] font-black shadow-sm ring-4 ring-chalk-raised transition-transform duration-200 group-hover:scale-110 group-hover:shadow-lg ${colorForType(company.type)}`}
                                >
                                  {isTarget ? 'T' : format.number(index + 1)}
                                </div>

                                {isTarget ? (
                                  <span className="absolute left-1/2 top-9 -translate-x-1/2 rounded-md border border-rule bg-chalk-raised px-2 py-1 text-[11px] font-bold text-moss shadow-sm whitespace-nowrap">
                                    {t('yourBrand')}
                                  </span>
                                ) : null}

                                {/* Tooltip Popup */}
                                <div className="pointer-events-none absolute left-1/2 top-12 z-50 hidden w-80 -translate-x-1/2 group-hover:block">
                                  {/* Reasons are sentences, so the tooltip
                                      goes back to the page's own direction. */}
                                  <div dir="auto" className="rounded-2xl border border-rule bg-chalk-raised p-4 text-start shadow-2xl">
                                    <div className="mb-3 flex items-start gap-3">
                                      <div
                                        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${colorForType(company.type)}`}
                                      >
                                        {isTarget ? 'T' : format.number(index + 1)}
                                      </div>
                                      <div className="min-w-0">
                                        {/* Company name and domain are raw
                                            data: never translated, and kept
                                            LTR inside Persian prose. */}
                                        <p className="font-bold text-[14px] text-moss tracking-tight">
                                          <bdi>{company.name}</bdi>
                                        </p>
                                        <p className="mt-0.5 truncate text-[11px] text-moss-muted font-medium" dir="ltr">
                                          {compactDomain(company.website)}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="grid gap-3">
                                      <div className="rounded-lg bg-chalk p-3 border border-rule">
                                        <p className="mb-1.5 flex justify-between text-[10px] uppercase font-bold text-moss-muted">
                                          <span><bdi>{selectedChart.axes.x}</bdi></span>
                                          <span className="text-moss">
                                            {t('scoreOutOfTen', { score: format.number(company.x_score) })}
                                          </span>
                                        </p>
                                        <p className="text-[12px] text-moss leading-relaxed font-medium">
                                          {company.x_reason}
                                        </p>
                                      </div>
                                      <div className="rounded-lg bg-chalk p-3 border border-rule">
                                        <p className="mb-1.5 flex justify-between text-[10px] uppercase font-bold text-moss-muted">
                                          <span><bdi>{selectedChart.axes.y}</bdi></span>
                                          <span className="text-moss">
                                            {t('scoreOutOfTen', { score: format.number(company.y_score) })}
                                          </span>
                                        </p>
                                        <p className="text-[12px] text-moss leading-relaxed font-medium">
                                          {company.y_reason}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="mt-4 flex items-center justify-between border-t border-rule pt-3">
                                      <span className="text-[10px] font-bold tracking-widest text-moss-muted uppercase">
                                        {t('confidence')}
                                      </span>
                                      <span className="text-[12px] font-black text-moss">
                                        {format.number(company.confidence_score, { style: 'percent' })}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                      </div>

                      {/* Chart insights */}
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-rule bg-chalk p-5">
                          <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-moss-muted mb-3">
                            <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                            {t('marketPattern')}
                          </h4>
                          <p className="text-[14px] text-moss leading-7 font-medium">
                            {selectedChart.summary.market_pattern}
                          </p>
                        </div>
                        
                        <div className="rounded-2xl border border-rule bg-chalk-sunk p-5">
                          <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-moss-700 mb-3">
                            <span className="h-2 w-2 rounded-full bg-moss"></span>
                            {t('actionableGap')}
                          </h4>
                          <p className="text-[14px] text-moss leading-7 font-bold">
                            {selectedChart.summary.positioning_opportunity}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-rule bg-chalk-raised p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h4 className="text-[11px] font-black uppercase tracking-widest text-moss-muted">
                            {t('plottedCompanies')}
                          </h4>
                          <span className="text-[11px] font-bold text-moss-muted">
                            {t('companyTotal', { count: format.number(selectedChart.companies.length) })}
                          </span>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                          {selectedChart.companies.map((company, index) => (
                            <div
                              key={`${selectedChart.chart_key}:list:${company.name}:${company.website}`}
                              className="flex min-w-0 items-center gap-3 rounded-lg border border-rule bg-chalk px-3 py-2"
                            >
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${colorForType(company.type)}`}
                              >
                                {company.type === 'TARGET' ? 'T' : format.number(index + 1)}
                              </span>
                              <div className="min-w-0 flex-1">
                                {/* Names and domains are raw data. */}
                                <p className="truncate text-[12px] font-bold text-moss">
                                  <bdi>{company.name}</bdi>
                                </p>
                                <p className="truncate text-[11px] text-moss-muted" dir="ltr">
                                  {compactDomain(company.website)}
                                </p>
                              </div>
                              <div className="shrink-0 text-end">
                                <p className={`text-[10px] font-bold uppercase ${textColorForType(company.type)}`}>
                                  {t(`legend.${legendKeyForType(company.type)}`)}
                                </p>
                                <p className="text-[11px] font-semibold text-moss-muted" dir="ltr">
                                  {format.number(company.x_score)}/{format.number(company.y_score)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

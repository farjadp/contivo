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
import { CORE_AXIS_KEYS, type StoredMarketAxis } from '@/lib/matrices/axes';
import { CompetitorMapManager } from './CompetitorMapManager';
import { AxesChooser } from './matrices/AxesChooser';
import { ChartInsights, MatrixSummaryCard } from './matrices/ChartInsights';
import { MatrixChart, dotClasses, legendKeyForType } from './matrices/MatrixChart';
import { MatrixRunHeader } from './matrices/MatrixRunHeader';
import { PointDrawer } from './matrices/PointDrawer';
import { TechnicalDetails } from './matrices/TechnicalDetails';
import type { AxisEnds } from './matrices/chart-geometry';
import { companyKey, compactDomain, type ChartView, type MatrixView } from './matrices/matrix-view';
import { POLL_INTERVAL_MS, isMatrixRunActive, refusalDuplicatesRun, shouldKeepPolling } from './matrices/matrix-run-logic';

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
  initialMatrices: MatrixView | null;
  targetMarket: { country: string | null; language: 'fa' | 'en' };
  discoveryMeta: DiscoveryMeta;
  discoveryArchive: DiscoveryArchiveItem[];
}) {
  const t = useTranslations('tabsB.matrices');
  const format = useFormatter();
  const [matrices, setMatrices] = useState<MatrixView | null>(initialMatrices);
  const [selectedKey, setSelectedKey] = useState<string>(
    initialMatrices?.charts?.[0]?.chart_key || 'price_value_depth',
  );
  const [showAxes, setShowAxes] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);

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

  const tAxes = useTranslations('tabsB.matrices.coreAxes');
  const selectedChart = useMemo(
    () => matrices?.charts.find((chart) => chart.chart_key === selectedKey) || null,
    [matrices, selectedKey],
  );

  // Wording for the four corners. Core charts read it from the catalogue; a
  // market chart reads it from the axes the run saved. Neither: no labels.
  const axisEndsFor = (chart: ChartView): AxisEnds | null => {
    if ((CORE_AXIS_KEYS as readonly string[]).includes(chart.chart_key)) {
      const key = chart.chart_key as (typeof CORE_AXIS_KEYS)[number];
      return {
        x: { low: tAxes(`${key}.x.low`), high: tAxes(`${key}.x.high`) },
        y: { low: tAxes(`${key}.y.low`), high: tAxes(`${key}.y.high`) },
      };
    }
    const saved = status?.savedAxes.find((axis) => axis.key === chart.chart_key);
    return saved ? { x: { low: saved.x.low, high: saved.x.high }, y: { low: saved.y.low, high: saved.y.high } } : null;
  };

  const selectedCompany = selectedChart?.companies.find((company) => companyKey(company) === selectedPoint) ?? null;

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
              {/* Sidebar: chart navigation and the read across all charts */}
              <div className="flex w-full shrink-0 flex-col border-e border-rule bg-chalk/60 lg:w-[280px] xl:w-[310px]">
                <div className="space-y-2 p-5">
                  <h4 className="px-2 pb-3 text-[10px] font-bold uppercase tracking-widest text-moss-muted">
                    {t('dimensions')}
                  </h4>
                  {matrices.charts.map((chart) => (
                    <button
                      key={chart.chart_key}
                      type="button"
                      aria-pressed={selectedKey === chart.chart_key}
                      onClick={() => {
                        setSelectedKey(chart.chart_key);
                        setSelectedPoint(null);
                      }}
                      className={`w-full rounded-lg px-4 py-3 text-start text-[13px] font-bold transition-all duration-200 ${
                        selectedKey === chart.chart_key
                          ? 'bg-chalk-raised text-moss shadow-sm ring-1 ring-rule'
                          : 'text-moss-muted hover:bg-chalk-raised hover:text-moss'
                      }`}
                    >
                      {chart.chart_name}
                    </button>
                  ))}
                </div>

                <div className="mt-auto shrink-0 border-t border-rule bg-chalk-raised p-5">
                  <MatrixSummaryCard matrices={matrices} />
                </div>
              </div>

              {/* Main area: the chart, its point drawer and what it means */}
              <div className="flex flex-1 flex-col overflow-visible bg-chalk-raised">
                {selectedChart && (
                  <div className="mx-auto flex h-full w-full max-w-[1280px] flex-col gap-6 p-5 md:p-7">
                    <div className="flex flex-col gap-3 border-b border-rule pb-5 lg:flex-row lg:items-end lg:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-2xl font-black tracking-tight text-moss md:text-3xl">
                          {selectedChart.chart_name}
                        </h3>
                        <p className="mt-2 text-[13px] font-medium text-moss-muted">
                          {t.rich('axesVs', {
                            x: selectedChart.axes.x,
                            y: selectedChart.axes.y,
                            /* Axis names come back from the model and are
                               data, not copy: isolated, not flipped. */
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
                            <span className={`h-3 w-3 rounded-full border ${dotClasses(type, false)}`} />
                            {t(`legend.${legendKeyForType(type)}`)}
                          </span>
                        ))}
                        <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-chalk-raised px-3 py-1 text-moss">
                          <span className="h-3 w-3 rounded-full border-2 border-rival bg-chalk-raised" />
                          {t('legend.estimated')}
                        </span>
                        {selectedChart.white_space ? (
                          <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-chalk-raised px-3 py-1 text-moss">
                            <span className="hatch-saffron h-3 w-3 rounded-sm border border-dashed border-saffron bg-saffron-soft/40" />
                            {t('legend.whiteSpace')}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <MatrixChart
                        chart={selectedChart}
                        axisEnds={axisEndsFor(selectedChart)}
                        selectedKey={selectedPoint}
                        onSelect={setSelectedPoint}
                      />
                      {selectedCompany ? (
                        <PointDrawer
                          workspaceId={workspaceId}
                          chart={selectedChart}
                          company={selectedCompany}
                          onClose={() => setSelectedPoint(null)}
                          onMatricesChange={(next) => setMatrices(next as MatrixView)}
                        />
                      ) : null}
                    </div>

                    <ChartInsights chart={selectedChart} />

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
                          <button
                            key={companyKey(company)}
                            type="button"
                            onClick={() => setSelectedPoint(companyKey(company))}
                            className="flex min-w-0 items-center gap-3 rounded-lg border border-rule bg-chalk px-3 py-2 text-start hover:border-rule-strong"
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${dotClasses(company.type, company.estimated === true)}`}
                            >
                              {company.type === 'TARGET' ? 'T' : format.number(index + 1)}
                            </span>
                            <span className="min-w-0 flex-1">
                              {/* Names and domains are raw data. */}
                              <span className="block truncate text-[12px] font-bold text-moss">
                                <bdi>{company.name}</bdi>
                              </span>
                              <span className="block truncate text-[11px] text-moss-muted" dir="ltr">
                                {compactDomain(company.website)}
                              </span>
                            </span>
                            <span className="shrink-0 text-end">
                              <span className="block text-[10px] font-bold uppercase text-moss-muted">
                                {t(`legend.${legendKeyForType(company.type)}`)}
                              </span>
                              <span className="block text-[11px] font-semibold text-moss-muted" dir="ltr">
                                {format.number(company.x_score)}/{format.number(company.y_score)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <TechnicalDetails matrices={matrices} />
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

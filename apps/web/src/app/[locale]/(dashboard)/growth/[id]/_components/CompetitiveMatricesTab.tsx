'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2, Save, Sparkles } from 'lucide-react';

import {
  generateWorkspaceCompetitiveMatrices,
  saveWorkspaceCompetitiveMatricesEdits,
} from '@/app/actions/growth-matrices';
import { CompetitorMapManager } from './CompetitorMapManager';

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

type CompetitorItem = {
  id: string;
  name: string;
  domain?: string | null;
  description?: string | null;
  category?: string | null;
  audienceGuess?: string | null;
  type?: string | null;
  userDecision?: string | null;
  source?: string | null;
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

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.55;
  return Math.max(0.3, Math.min(1, value));
}

export function CompetitiveMatricesTab({
  workspaceId,
  initialMatrices,
  initialCompetitors,
  discoveryMeta,
  discoveryArchive,
}: {
  workspaceId: string;
  initialMatrices: CompetitiveMatrixPayload | null;
  initialCompetitors: CompetitorItem[];
  discoveryMeta: DiscoveryMeta;
  discoveryArchive: DiscoveryArchiveItem[];
}) {
  const t = useTranslations('tabsB.matrices');
  const format = useFormatter();
  const [matrices, setMatrices] = useState<CompetitiveMatrixPayload | null>(initialMatrices);
  const [selectedKey, setSelectedKey] = useState<string>(
    initialMatrices?.charts?.[0]?.chart_key || 'price_value_depth',
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // UI Toggles for reducing clutter
  const [showTokens, setShowTokens] = useState(false);
  const [showEditScores, setShowEditScores] = useState(false);

  const selectedChart = useMemo(
    () => matrices?.charts.find((chart) => chart.chart_key === selectedKey) || null,
    [matrices, selectedKey],
  );

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateWorkspaceCompetitiveMatrices(workspaceId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.matrices) {
        const next = result.matrices as CompetitiveMatrixPayload;
        setMatrices(next);
        setSelectedKey(next.charts?.[0]?.chart_key || 'price_value_depth');
        setSuccess(t('generated'));
      }
    } catch (generateError) {
      console.error(generateError);
      setError(t('generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const saveEdits = async () => {
    if (!matrices) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await saveWorkspaceCompetitiveMatricesEdits(workspaceId, matrices);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.matrices) {
        setMatrices(result.matrices as CompetitiveMatrixPayload);
        setSuccess(t('saved'));
      }
    } catch (saveError) {
      console.error(saveError);
      setError(t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateScore = (
    chartKey: string,
    companyName: string,
    field: 'x_score' | 'y_score' | 'confidence_score',
    value: number,
  ) => {
    if (!matrices) return;
    setMatrices({
      ...matrices,
      charts: matrices.charts.map((chart) => {
        if (chart.chart_key !== chartKey) return chart;
        return {
          ...chart,
          companies: chart.companies.map((company) => {
            if (company.name !== companyName) return company;
            if (field === 'confidence_score') {
              return { ...company, confidence_score: clampConfidence(value) };
            }
            return { ...company, [field]: clampScore(value) };
          }),
        };
      }),
    });
  };

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-12 w-full max-w-[1500px] mx-auto">
      {/* 1. Competitors Management Area */}
      <section className="relative overflow-hidden rounded-[2rem] border border-rule bg-chalk-raised shadow-sm">
        <div className="bg-gradient-to-r from-chalk/50 to-chalk-raised px-6 py-5 border-b border-rule flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-moss tracking-tight">{t('landscapeTitle')}</h2>
            <p className="text-[13px] text-moss-muted mt-1 max-w-2xl">{t('landscapeSubtitle')}</p>
          </div>
        </div>
        <div className="p-6 bg-chalk-raised">
          <CompetitorMapManager
            workspaceId={workspaceId}
            initialCompetitors={initialCompetitors}
            initialMeta={discoveryMeta}
            initialArchive={discoveryArchive}
            onMatricesUpdated={setMatrices}
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
            <button
              type="button"
              onClick={saveEdits}
              disabled={isSaving || !matrices}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-chalk-raised border border-rule px-4 py-2 text-[13px] font-bold text-moss transition hover:bg-chalk hover:border-rule-strong disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 text-moss-muted" />}
              {t('saveOverrides')}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-moss px-5 py-2 text-[13px] font-bold text-chalk transition hover:bg-moss disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-saffron" />}
              {t('generate')}
            </button>
          </div>
        </div>

        {/* Global Notifications / Status */}
        {(error || success || showTokens) && (
          <div className="px-6 py-4 border-b border-rule bg-chalk/30 space-y-3">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3.5 text-[13px] font-medium shadow-sm">{error}</div>}
            {success && <div className="rounded-xl border border-rule bg-chalk-sunk text-moss p-3.5 text-[13px] font-medium shadow-sm">{success}</div>}
            
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

                    {/* Manual Score Editor Component */}
                    <div className="mt-12 border border-rule rounded-[2rem] bg-chalk-raised overflow-hidden shadow-sm transition-all duration-300">
                      <div className="px-7 py-5 flex flex-col sm:flex-row sm:items-center justify-between bg-chalk/50 border-b border-rule gap-4">
                        <div>
                          <h4 className="text-[14px] font-black text-moss tracking-tight">{t('fineTuneTitle')}</h4>
                          <p className="text-[12px] text-moss-muted mt-1 font-medium max-w-lg">{t('fineTuneBody')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowEditScores(!showEditScores)}
                          className={`px-5 py-2.5 text-[13px] font-bold rounded-xl transition shadow-sm w-full sm:w-auto text-center border ${
                            showEditScores 
                            ? 'bg-chalk-sunk border-rule-strong text-moss hover:bg-chalk-sunk' 
                            : 'bg-chalk-raised border-rule text-moss hover:bg-chalk hover:border-rule-strong'
                          }`}
                        >
                          {showEditScores ? t('closeEditor') : t('openEditor')}
                        </button>
                      </div>

                      {showEditScores && (
                        <div className="p-7 space-y-3 bg-chalk-raised">
                          <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr] px-4 hidden md:grid mb-2">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('competitorIdentity')}</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-moss-muted"><bdi>{selectedChart.axes.x}</bdi></div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-moss-muted"><bdi>{selectedChart.axes.y}</bdi></div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('aiTrustScore')}</div>
                          </div>
                          
                          <div className="space-y-3">
                            {selectedChart.companies.map((company) => (
                              <div
                                key={`${selectedChart.chart_key}:edit:${company.name}:${company.website}`}
                                className="grid gap-5 rounded-2xl border border-rule bg-chalk/60 p-5 md:grid-cols-[1.5fr_1fr_1fr_1fr] items-center transition hover:bg-chalk-raised hover:border-rule hover:shadow-sm"
                              >
                                <div className="min-w-0 pe-4 md:border-e md:border-rule">
                                  <p className="truncate text-[15px] font-bold text-moss flex items-center gap-2 mb-1">
                                    <span className={`h-3 w-3 shrink-0 rounded-full border ${colorForType(company.type)}`}></span>
                                    <bdi>{company.name}</bdi>
                                  </p>
                                  <p className="truncate text-[12px] font-medium text-moss-muted ms-5" dir="ltr">{company.website.replace(/^https?:\/\//, '')}</p>
                                </div>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-moss-muted mb-1.5 md:hidden tracking-widest"><bdi>{selectedChart.axes.x}</bdi></span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={company.x_score}
                                    onChange={(event) =>
                                      updateScore(
                                        selectedChart.chart_key,
                                        company.name,
                                        'x_score',
                                        Number(event.target.value),
                                      )
                                    }
                                    className="w-full rounded-xl border border-rule bg-chalk-raised px-5 py-3 text-[15px] text-moss font-black transition focus:border-moss focus:ring-2 focus:ring-rule shadow-sm"
                                  />
                                </label>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-moss-muted mb-1.5 md:hidden tracking-widest"><bdi>{selectedChart.axes.y}</bdi></span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={company.y_score}
                                    onChange={(event) =>
                                      updateScore(
                                        selectedChart.chart_key,
                                        company.name,
                                        'y_score',
                                        Number(event.target.value),
                                      )
                                    }
                                    className="w-full rounded-xl border border-rule bg-chalk-raised px-5 py-3 text-[15px] text-moss font-black transition focus:border-moss focus:ring-2 focus:ring-rule shadow-sm"
                                  />
                                </label>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-moss-muted mb-1.5 md:hidden tracking-widest">{t('confidenceScore')}</span>
                                  <input
                                    type="number"
                                    min={0.3}
                                    max={1}
                                    step={0.01}
                                    value={Number(company.confidence_score.toFixed(2))}
                                    onChange={(event) =>
                                      updateScore(
                                        selectedChart.chart_key,
                                        company.name,
                                        'confidence_score',
                                        Number(event.target.value),
                                      )
                                    }
                                    className="w-full rounded-xl border border-rule bg-chalk-raised px-5 py-3 text-[15px] text-moss font-bold transition focus:border-moss focus:ring-2 focus:ring-rule shadow-sm"
                                  />
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

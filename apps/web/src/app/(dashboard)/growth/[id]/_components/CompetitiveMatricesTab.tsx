'use client';

import { useMemo, useState } from 'react';
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
  if (type === 'TARGET') return 'bg-indigo-600 border-indigo-200';
  if (type === 'INDIRECT') return 'bg-amber-400 border-amber-200';
  if (type === 'ASPIRATIONAL') return 'bg-emerald-400 border-emerald-200';
  return 'bg-rose-500 border-rose-200';
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
        setSuccess('Competitive matrices generated from public signals. Please review and adjust as needed.');
      }
    } catch (generateError) {
      console.error(generateError);
      setError('Unexpected error while generating matrices.');
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
        setSuccess('Matrix edits saved.');
      }
    } catch (saveError) {
      console.error(saveError);
      setError('Unexpected error while saving matrix edits.');
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
      <section className="relative overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-50/50 to-white px-6 py-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#121212] tracking-tight">Competitive Landscape</h2>
            <p className="text-[13px] text-gray-500 mt-1 max-w-2xl">
              Verify and manage your market players. Their profiles power the AI positioning charts below.
            </p>
          </div>
        </div>
        <div className="p-6 bg-white">
          <CompetitorMapManager
            workspaceId={workspaceId}
            initialCompetitors={initialCompetitors}
            initialMeta={discoveryMeta}
            initialArchive={discoveryArchive}
          />
        </div>
      </section>

      {/* 2. Market Matrices Area */}
      <section className="relative overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-md flex flex-col min-h-[600px]">
        {/* Header toolbar */}
        <div className="bg-gradient-to-r from-gray-50/50 to-white px-6 py-5 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-[#121212] tracking-tight">Positioning Matrices</h2>
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800 uppercase tracking-widest shadow-sm">
                AI Generated
              </span>
            </div>
            <p className="max-w-xl text-[13px] text-gray-500 mt-1">
              Visualize your market position across 5 critical dimensions to find your strongest differentiation hook.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {matrices?.token_usage && (
              <button
                type="button"
                onClick={() => setShowTokens(!showTokens)}
                className="inline-flex items-center rounded-xl bg-white border border-gray-200 px-4 py-2 text-[13px] font-bold text-gray-700 transition hover:bg-gray-50 hover:border-gray-300 shadow-sm"
              >
                {showTokens ? 'Hide Diagnostics' : 'View Diagnostics'}
              </button>
            )}
            <button
              type="button"
              onClick={saveEdits}
              disabled={isSaving || !matrices}
              className="inline-flex items-center gap-2 rounded-xl bg-white border border-gray-200 px-4 py-2 text-[13px] font-bold text-[#121212] transition hover:bg-gray-50 hover:border-gray-300 shadow-sm disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 text-gray-500" />}
              Save Overrides
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-xl bg-[#121212] px-5 py-2 text-[13px] font-bold text-white transition shadow-md hover:bg-black hover:shadow-lg disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-emerald-400" />}
              Generate AI Matrices
            </button>
          </div>
        </div>

        {/* Global Notifications / Status */}
        {(error || success || showTokens) && (
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/30 space-y-3">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3.5 text-[13px] font-medium shadow-sm">{error}</div>}
            {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 p-3.5 text-[13px] font-medium shadow-sm">{success}</div>}
            
            {showTokens && matrices?.token_usage && (
              <div className="grid gap-4 pt-2 md:grid-cols-2">
                <div className="rounded-2xl bg-white p-5 border border-gray-200 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-400"></span>Last Run Data
                  </p>
                  {matrices.token_usage.last_run ? (
                    <div className="space-y-3 text-[13px] text-gray-700">
                      <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Prompt Tokens:</span>
                        <span className="font-bold text-[#121212] text-[14px]">{matrices.token_usage.last_run.prompt_tokens.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Completion Tokens:</span>
                        <span className="font-bold text-[#121212] text-[14px]">{matrices.token_usage.last_run.completion_tokens.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <span className="text-gray-900 font-bold">Total Tokens:</span>
                        <span className="font-black text-indigo-700 text-[15px]">{matrices.token_usage.last_run.total_tokens.toLocaleString()}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 pt-3 mt-1 text-right">
                        Model: {matrices.token_usage.last_run.model} &bull; {new Date(matrices.token_usage.last_run.created_at).toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-gray-500">No token data available yet.</p>
                  )}
                </div>

                <div className="rounded-2xl bg-white p-5 border border-gray-200 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400"></span>Lifetime Usage
                  </p>
                  <div className="space-y-3 text-[13px] text-gray-700">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                      <span className="text-gray-500">Total Generation Runs:</span>
                      <span className="font-bold text-[#121212] text-[14px]">{matrices.token_usage.runs.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                      <span className="text-gray-500">Accumulated Prompts:</span>
                      <span className="font-bold text-[#121212] text-[14px]">{matrices.token_usage.lifetime_prompt_tokens.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                      <span className="text-gray-500">Accumulated Completions:</span>
                      <span className="font-bold text-[#121212] text-[14px]">{matrices.token_usage.lifetime_completion_tokens.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-gray-900 font-bold">Lifetime Total:</span>
                      <span className="font-black text-emerald-700 text-[15px]">{matrices.token_usage.lifetime_total_tokens.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dashboard Split View */}
        <div className="flex flex-col lg:flex-row flex-1 bg-white">
          {!matrices || matrices.charts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-16 text-center text-gray-500 bg-gray-50/30">
              <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-5 border border-gray-200 shadow-sm">
                <Sparkles className="h-8 w-8 text-gray-300" />
              </div>
              <p className="text-lg font-bold text-[#121212] mb-2 tracking-tight">No Matrices Generated</p>
              <p className="text-[14px] max-w-sm leading-relaxed">
                Generate market matrices to automatically analyze and plot your competitive positioning across dimensions.
              </p>
            </div>
          ) : (
            <>
              {/* Sidebar: Navigation & Macro Summary */}
              <div className="w-full lg:w-[280px] xl:w-[320px] shrink-0 border-r border-gray-100 bg-gray-50/40 flex flex-col">
                <div className="p-5 space-y-2 flex-1">
                  <h4 className="px-3 pb-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Strategic Dimensions
                  </h4>
                  {matrices.charts.map((chart: any) => (
                    <button
                      key={chart.chart_key}
                      type="button"
                      onClick={() => setSelectedKey(chart.chart_key)}
                      className={`w-full text-left rounded-xl px-4 py-3.5 text-[13px] font-bold transition-all duration-200 ${
                        selectedKey === chart.chart_key
                          ? 'bg-white text-[#121212] shadow-sm ring-1 ring-gray-200'
                          : 'text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm'
                      }`}
                    >
                      {chart.chart_name}
                    </button>
                  ))}
                </div>

                <div className="mt-auto p-6 border-t border-gray-100 space-y-6 bg-white shrink-0">
                  <div className="space-y-3">
                    <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                      <div className="h-2 w-2 rounded-full bg-indigo-500"></div>
                      Macro Opportunity
                    </h4>
                    <p className="text-[13px] font-semibold tracking-tight text-indigo-950 bg-indigo-50/80 rounded-2xl p-4 leading-relaxed border border-indigo-100">
                      {matrices.strongest_differentiation_opportunity}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      <div className="h-2 w-2 rounded-full border-2 border-gray-300 bg-white"></div>
                      Cross-Chart Synthesis
                    </h4>
                    <p className="text-[13px] text-gray-700 leading-relaxed pl-4 border-l-[3px] border-gray-200">
                      {matrices.cross_chart_summary}
                    </p>
                  </div>
                </div>
              </div>

              {/* Main Area: Chart Visualization */}
              <div className="flex-1 flex flex-col bg-white overflow-hidden">
                {selectedChart && (
                  <div className="p-6 md:p-8 flex flex-col h-full w-full mx-auto max-w-[1240px]">
                    <div className="mb-8 pl-2">
                      <h3 className="text-3xl font-black text-[#121212] tracking-tight">{selectedChart.chart_name}</h3>
                      <p className="text-[14px] text-gray-500 mt-2 font-medium">
                        Plotting <span className="text-[#121212] font-bold px-1">{selectedChart.axes.y}</span> against <span className="text-[#121212] font-bold px-1">{selectedChart.axes.x}</span>
                      </p>
                    </div>

                    <div className="grid gap-8 xl:grid-cols-[1fr_340px]">
                      {/* The Chart Container */}
                      <div className="relative h-[480px] w-full rounded-[2.5rem] border-l-[3px] border-b-[3px] border-gray-200 bg-gradient-to-tr from-gray-50/80 to-white shadow-inner">
                        <span className="absolute -left-[3.5rem] top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap">
                          {selectedChart.axes.y} &rarr;
                        </span>
                        <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap">
                          {selectedChart.axes.x} &rarr;
                        </span>

                        {/* Chart Grid Lines */}
                        <div className="absolute inset-x-0 top-1/2 h-px bg-gray-200/60 w-full pointer-events-none -translate-y-1/2 border-dashed"></div>
                        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-200/60 h-full pointer-events-none -translate-x-1/2 border-dashed"></div>

                        {selectedChart.companies.map((company) => {
                          const x = scoreToPercent(company.x_score);
                          const y = 100 - scoreToPercent(company.y_score);
                          return (
                            <div
                              key={`${selectedChart.chart_key}:${company.name}:${company.website}`}
                              className="group absolute"
                              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                            >
                              {/* Bubble */}
                              <div className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 shadow-sm transition-transform duration-300 group-hover:scale-[1.3] z-10 ${colorForType(company.type)}`} />
                              
                              <span className="absolute left-1/2 -translate-x-1/2 pt-2.5 text-[11px] font-bold text-gray-500 transition-all duration-300 group-hover:scale-110 group-hover:text-[#121212] pointer-events-none whitespace-nowrap">
                                {company.name}
                              </span>

                              {/* Tooltip Popup */}
                              <div className="pointer-events-none absolute left-1/2 top-11 z-50 hidden w-80 -translate-x-1/2 opacity-0 group-hover:block hover:opacity-100 transition-all duration-300 group-hover:opacity-100">
                                <div className="rounded-3xl border border-gray-200/60 bg-white/95 backdrop-blur-2xl p-5 shadow-2xl">
                                  <div className="flex items-center gap-2.5 mb-2">
                                    <div className={`h-3 w-3 rounded-full ${colorForType(company.type).replace('border-', 'bg-')}`}></div>
                                    <p className="font-bold text-[15px] text-[#121212] tracking-tight">{company.name}</p>
                                  </div>
                                  <p className="text-[11px] text-gray-500 font-medium mb-4 pl-5">{company.website.replace(/^https?:\/\//, '')}</p>
                                  
                                  <div className="space-y-4">
                                    <div className="rounded-xl bg-gray-50/50 p-3 border border-gray-100">
                                      <p className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 flex justify-between">
                                        <span>{selectedChart.axes.x}</span>
                                        <span className="text-gray-800 bg-white px-2 py-0.5 rounded-md border border-gray-200">{company.x_score}/10</span>
                                      </p>
                                      <p className="text-[12px] text-gray-700 leading-relaxed font-medium">{company.x_reason}</p>
                                    </div>
                                    <div className="rounded-xl bg-gray-50/50 p-3 border border-gray-100">
                                      <p className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 flex justify-between">
                                        <span>{selectedChart.axes.y}</span>
                                        <span className="text-gray-800 bg-white px-2 py-0.5 rounded-md border border-gray-200">{company.y_score}/10</span>
                                      </p>
                                      <p className="text-[12px] text-gray-700 leading-relaxed font-medium">{company.y_reason}</p>
                                    </div>
                                  </div>
                                  <div className="mt-5 pt-4 flex items-center justify-between border-t border-gray-100">
                                    <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">AI Confidence Metric</span>
                                    <span className="text-[12px] font-black text-[#121212] bg-gray-100 px-2 py-1 rounded-lg">{Math.round(company.confidence_score * 100)}%</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Right Rail: Specific insights for THIS chart */}
                      <div className="flex flex-col space-y-5">
                        <div className="rounded-[2rem] border border-gray-100 bg-gray-50/70 p-7 shadow-sm">
                          <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">
                            <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                            Market Pattern observed
                          </h4>
                          <p className="text-[14px] text-[#121212] leading-loose font-medium">
                            {selectedChart.summary.market_pattern}
                          </p>
                        </div>
                        
                        <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50/70 p-7 shadow-sm">
                          <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3">
                            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                            Actionable Gap
                          </h4>
                          <p className="text-[14px] text-emerald-950 leading-loose font-bold">
                            {selectedChart.summary.positioning_opportunity}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Manual Score Editor Component */}
                    <div className="mt-12 border border-gray-200 rounded-[2rem] bg-white overflow-hidden shadow-sm transition-all duration-300">
                      <div className="px-7 py-5 flex flex-col sm:flex-row sm:items-center justify-between bg-gray-50/50 border-b border-gray-200 gap-4">
                        <div>
                          <h4 className="text-[14px] font-black text-[#121212] tracking-tight">Fine-tune Plotting Coordinates</h4>
                          <p className="text-[12px] text-gray-500 mt-1 font-medium max-w-lg">Override AI estimated scores below to manually correct the plotted outcomes natively for this chart.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowEditScores(!showEditScores)}
                          className={`px-5 py-2.5 text-[13px] font-bold rounded-xl transition shadow-sm w-full sm:w-auto text-center border ${
                            showEditScores 
                            ? 'bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200' 
                            : 'bg-white border-gray-200 text-[#121212] hover:bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          {showEditScores ? 'Close Coordinate Settings' : 'Reveal Score Editor'}
                        </button>
                      </div>

                      {showEditScores && (
                        <div className="p-7 space-y-3 bg-white">
                          <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr] px-4 hidden md:grid mb-2">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Competitor Identity</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{selectedChart.axes.x}</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{selectedChart.axes.y}</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">AI Trust Score</div>
                          </div>
                          
                          <div className="space-y-3">
                            {selectedChart.companies.map((company) => (
                              <div
                                key={`${selectedChart.chart_key}:edit:${company.name}:${company.website}`}
                                className="grid gap-5 rounded-2xl border border-gray-100 bg-gray-50/60 p-5 md:grid-cols-[1.5fr_1fr_1fr_1fr] items-center transition hover:bg-white hover:border-gray-200 hover:shadow-sm"
                              >
                                <div className="min-w-0 pr-4 md:border-r md:border-gray-200">
                                  <p className="truncate text-[15px] font-bold text-[#121212] flex items-center gap-2 mb-1">
                                    <span className={`h-3 w-3 rounded-full ${colorForType(company.type).replace('border-', 'bg-')}`}></span>
                                    {company.name}
                                  </p>
                                  <p className="truncate text-[12px] font-medium text-gray-400 ml-5">{company.website.replace(/^https?:\/\//, '')}</p>
                                </div>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-gray-400 mb-1.5 md:hidden tracking-widest">{selectedChart.axes.x}</span>
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
                                    className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-[15px] text-[#121212] font-black transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-sm"
                                  />
                                </label>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-gray-400 mb-1.5 md:hidden tracking-widest">{selectedChart.axes.y}</span>
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
                                    className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-[15px] text-[#121212] font-black transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-sm"
                                  />
                                </label>
                                
                                <label className="flex flex-col md:block">
                                  <span className="text-[10px] font-bold uppercase text-gray-400 mb-1.5 md:hidden tracking-widest">Confidence Score</span>
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
                                    className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-[15px] text-[#121212] font-bold transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-sm"
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

'use client';

/**
 * SEO Intelligence Tab
 *
 * Powered by real DataForSEO API data — NOT AI-estimated.
 * Three sub-sections:
 *   1. Competitor Keywords — real keyword rankings per domain
 *   2. Keyword Opportunities — gap keywords scored by opportunity value
 *   3. SERP Insights — AI-analyzed insight reports per keyword
 *
 * Rate limits (enforced server-side):
 *   - Competitor scan: once per 7 days per domain
 *   - SERP analysis:   once per 24 hours per keyword
 */

import { useState, useTransition } from 'react';
import {
  TrendingUp,
  Loader2,
  Search,
  BarChart2,
  Target,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Zap,
  Globe,
} from 'lucide-react';
import {
  scanCompetitorKeywords,
  computeKeywordOpportunities,
  analyzeSerpForKeyword,
} from '@/app/actions/seo-intelligence';

// ─── Types ────────────────────────────────────────────────────────────────────

type CompetitorKw = {
  id: string;
  competitorDomain: string;
  keyword: string;
  searchVolume: number;
  difficulty: number;
  competition: number;
  rankingPosition: number | null;
  rankingUrl: string | null;
  createdAt: Date;
};

type KeywordOpp = {
  id: string;
  keyword: string;
  searchVolume: number;
  competition: number;
  opportunityScore: number;
  sourceCompetitor: string | null;
};

type SerpAnalysisSummary = {
  id: string;
  keyword: string;
  analysis: string;
  createdAt: Date;
};

type DomainScan = Record<string, Date>;

type Props = {
  workspaceId: string;
  acceptedCompetitorDomains: string[];
  initialDomainGroups: Record<string, CompetitorKw[]>;
  initialDomainScans: DomainScan;
  initialOpportunities: KeywordOpp[];
  initialSerpAnalyses: SerpAnalysisSummary[];
};

// ─── Sub-tab keys ─────────────────────────────────────────────────────────────

type SeoTab = 'competitor_keywords' | 'opportunities' | 'serp_insights';

const SEO_TABS: { key: SeoTab; label: string; icon: React.ReactNode }[] = [
  { key: 'competitor_keywords', label: 'Competitor Keywords', icon: <Globe className="w-3.5 h-3.5" /> },
  { key: 'opportunities', label: 'Keyword Opportunities', icon: <Target className="w-3.5 h-3.5" /> },
  { key: 'serp_insights', label: 'SERP Insights', icon: <Search className="w-3.5 h-3.5" /> },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function scanCooldownDaysLeft(lastScan: Date): number {
  const ageMs = Date.now() - new Date(lastScan).getTime();
  if (ageMs >= SEVEN_DAYS_MS) return 0;
  return Math.ceil((SEVEN_DAYS_MS - ageMs) / (24 * 60 * 60 * 1000));
}

function serpCooldownHoursLeft(lastScan: Date): number {
  const ageMs = Date.now() - new Date(lastScan).getTime();
  if (ageMs >= ONE_DAY_MS) return 0;
  return Math.ceil((ONE_DAY_MS - ageMs) / (60 * 60 * 1000));
}

function difficultyColor(d: number): string {
  if (d >= 70) return 'bg-red-100 text-red-700';
  if (d >= 40) return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function competitionLabel(c: number): string {
  if (c >= 0.7) return 'High';
  if (c >= 0.4) return 'Medium';
  return 'Low';
}

function competitionColor(c: number): string {
  if (c >= 0.7) return 'text-red-600 bg-red-50 border border-red-100';
  if (c >= 0.4) return 'text-amber-600 bg-amber-50 border border-amber-100';
  return 'text-emerald-600 bg-emerald-50 border border-emerald-100';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SeoIntelligenceTab({
  workspaceId,
  acceptedCompetitorDomains,
  initialDomainGroups,
  initialDomainScans,
  initialOpportunities,
  initialSerpAnalyses,
}: Props) {
  const [activeTab, setActiveTab] = useState<SeoTab>('competitor_keywords');

  // ── Competitor Keywords state ─────────────────────────────────────────────
  const [domainGroups] = useState(initialDomainGroups);
  const [domainScans] = useState(initialDomainScans);
  const [scanningDomain, setScanningDomain] = useState<string | null>(null);
  const [scanMessages, setScanMessages] = useState<Record<string, string>>({});
  const [selectedDomain, setSelectedDomain] = useState<string>(
    acceptedCompetitorDomains[0] || Object.keys(initialDomainGroups)[0] || '',
  );

  // ── Opportunities state ───────────────────────────────────────────────────
  const [opportunities] = useState(initialOpportunities);
  const [isComputingOpps, startComputingOpps] = useTransition();
  const [oppsMessage, setOppsMessage] = useState<string | null>(null);

  // ── SERP state ────────────────────────────────────────────────────────────
  const [serpAnalyses] = useState(initialSerpAnalyses);
  const [serpKeyword, setSerpKeyword] = useState('');
  const [isAnalyzingSerp, startAnalyzingSerp] = useTransition();
  const [serpMessage, setSerpMessage] = useState<string | null>(null);
  const [expandedSerp, setExpandedSerp] = useState<string | null>(null);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleScanDomain = async (domain: string) => {
    setScanningDomain(domain);
    setScanMessages((prev) => ({ ...prev, [domain]: '' }));
    try {
      const result = await scanCompetitorKeywords(workspaceId, domain);
      if ('skipped' in result && result.skipped) {
        setScanMessages((prev) => ({ ...prev, [domain]: result.reason ?? 'Cooldown active.' }));
        return;
      }
      if ('error' in result && result.error) {
        setScanMessages((prev) => ({ ...prev, [domain]: `Error: ${result.error}` }));
        return;
      }
      // Reload page to pick up new data (lightweight full-page refresh)
      window.location.reload();
    } catch (e) {
      setScanMessages((prev) => ({ ...prev, [domain]: 'An unexpected error occurred.' }));
    } finally {
      setScanningDomain(null);
    }
  };

  const handleComputeOpportunities = () => {
    startComputingOpps(async () => {
      setOppsMessage(null);
      try {
        const result = await computeKeywordOpportunities(workspaceId);
        if ('error' in result && result.error) {
          setOppsMessage(`Error: ${result.error}`);
          return;
        }
        window.location.reload();
      } catch {
        setOppsMessage('Failed to compute opportunities. Try again.');
      }
    });
  };

  const handleAnalyzeSerp = () => {
    if (!serpKeyword.trim()) return;
    startAnalyzingSerp(async () => {
      setSerpMessage(null);
      try {
        const result = await analyzeSerpForKeyword(workspaceId, serpKeyword.trim());
        if ('skipped' in result && result.skipped) {
          setSerpMessage(result.reason ?? 'Cooldown active.');
          // Even when skipped, we may have a cached analysis to show
          return;
        }
        if ('error' in result && result.error) {
          setSerpMessage(`Error: ${result.error}`);
          return;
        }
        window.location.reload();
      } catch {
        setSerpMessage('Failed to analyze SERP. Try again.');
      }
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const domainsWithKeywords = Object.keys(domainGroups);
  const selectedKeywords = domainGroups[selectedDomain] || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-600 text-white shadow">
          <TrendingUp className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-[#121212]">SEO Intelligence</h2>
          <p className="text-[11px] text-gray-500">Powered by real DataForSEO data — not AI-estimated</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {SEO_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab.key
                ? 'border-[#121212] bg-[#121212] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════ Sub-tab 1: Competitor Keywords ════════ */}
      {activeTab === 'competitor_keywords' ? (
        <div className="space-y-4">
          {/* Scan buttons for each accepted competitor */}
          {acceptedCompetitorDomains.length === 0 && domainsWithKeywords.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              <AlertCircle className="w-5 h-5 mx-auto mb-2 text-gray-400" />
              No accepted competitors found. Accept competitors in the Competitor Map tab first.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...new Set([...acceptedCompetitorDomains, ...domainsWithKeywords])].map((domain) => {
                  const lastScan = domainScans[domain] ? new Date(domainScans[domain]) : null;
                  const daysLeft = lastScan ? scanCooldownDaysLeft(lastScan) : 0;
                  const rowCount = domainGroups[domain]?.length ?? 0;
                  const isScanning = scanningDomain === domain;

                  return (
                    <div key={domain} className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-[#121212] truncate max-w-[160px]">{domain}</p>
                          {rowCount > 0 ? (
                            <p className="text-[11px] text-gray-500 mt-0.5">{rowCount} keywords stored</p>
                          ) : (
                            <p className="text-[11px] text-gray-400 mt-0.5">Not scanned yet</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedDomain(domain)}
                          className={`text-[11px] font-semibold px-2 py-1 rounded-lg transition ${
                            selectedDomain === domain
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {selectedDomain === domain ? 'Viewing' : 'View'}
                        </button>
                      </div>

                      {lastScan ? (
                        <p className="text-[11px] text-gray-500">
                          Last scan: {new Date(lastScan).toLocaleDateString()}
                          {daysLeft > 0 ? ` · Next in ${daysLeft}d` : ' · Ready to rescan'}
                        </p>
                      ) : null}

                      {scanMessages[domain] ? (
                        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
                          {scanMessages[domain]}
                        </p>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleScanDomain(domain)}
                        disabled={isScanning || (daysLeft > 0 && !scanMessages[domain])}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#121212] text-white px-3 py-2 text-xs font-bold transition hover:bg-black disabled:opacity-50"
                      >
                        {isScanning ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Scanning...</>
                        ) : rowCount > 0 ? (
                          <><RefreshCw className="w-3 h-3" /> Rescan</>
                        ) : (
                          <><Zap className="w-3 h-3" /> Scan Keywords</>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Keyword table for selected domain */}
              {selectedKeywords.length > 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="text-xs font-bold text-[#121212]">
                      Keywords from <span className="text-indigo-600">{selectedDomain}</span>
                    </h3>
                    <span className="text-[11px] text-gray-500">{selectedKeywords.length} keywords</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/30">
                          <th className="px-4 py-2.5 text-left font-bold text-gray-600">Keyword</th>
                          <th className="px-4 py-2.5 text-right font-bold text-gray-600">Volume</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">Difficulty</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">Competition</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">Rank</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedKeywords.slice(0, 100).map((kw, idx) => (
                          <tr
                            key={kw.id}
                            className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                          >
                            <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[240px] truncate">
                              {kw.keyword}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                              {kw.searchVolume.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${difficultyColor(kw.difficulty)}`}>
                                {kw.difficulty}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${competitionColor(kw.competition)}`}>
                                {competitionLabel(kw.competition)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center text-gray-500 font-medium">
                              {kw.rankingPosition ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selectedKeywords.length > 100 ? (
                      <p className="px-4 py-3 text-[11px] text-gray-400">
                        Showing top 100 of {selectedKeywords.length} keywords
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : selectedDomain ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                  No keywords scanned yet for <strong>{selectedDomain}</strong>. Click "Scan Keywords" above.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* ════════ Sub-tab 2: Keyword Opportunities ════════ */}
      {activeTab === 'opportunities' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleComputeOpportunities}
              disabled={isComputingOpps}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {isComputingOpps ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
              Compute Opportunities
            </button>
            <p className="text-xs text-gray-500">
              Runs gap analysis across all competitor keyword data you've scanned.
            </p>
          </div>

          {oppsMessage ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {oppsMessage}
            </div>
          ) : null}

          {opportunities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              No keyword opportunities yet. Scan at least one competitor's keywords first, then compute opportunities.
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-xs font-bold text-[#121212]">Top Keyword Opportunities</h3>
                <span className="text-[11px] text-gray-500">{opportunities.length} gaps found</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/30">
                      <th className="px-4 py-2.5 text-left font-bold text-gray-600">#</th>
                      <th className="px-4 py-2.5 text-left font-bold text-gray-600">Keyword</th>
                      <th className="px-4 py-2.5 text-right font-bold text-gray-600">Volume</th>
                      <th className="px-4 py-2.5 text-center font-bold text-gray-600">Competition</th>
                      <th className="px-4 py-2.5 text-left font-bold text-gray-600">Score</th>
                      <th className="px-4 py-2.5 text-left font-bold text-gray-600">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((opp, idx) => {
                      const maxScore = opportunities[0]?.opportunityScore ?? 1;
                      const pct = Math.round((opp.opportunityScore / maxScore) * 100);

                      return (
                        <tr
                          key={opp.id}
                          className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                        >
                          <td className="px-4 py-2.5 font-bold text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-[240px]">
                            <button
                              type="button"
                              onClick={() => {
                                setSerpKeyword(opp.keyword);
                                setActiveTab('serp_insights');
                              }}
                              className="hover:text-indigo-600 transition-colors text-left"
                              title="Analyze this keyword in SERP Insights"
                            >
                              {opp.keyword}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                            {opp.searchVolume.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${competitionColor(opp.competition)}`}>
                              {competitionLabel(opp.competition)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-indigo-500 transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-bold text-gray-600 w-8 text-right">
                                {opp.opportunityScore.toFixed(1)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-gray-400 max-w-[120px] truncate">
                            {opp.sourceCompetitor ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ════════ Sub-tab 3: SERP Insights ════════ */}
      {activeTab === 'serp_insights' ? (
        <div className="space-y-4">
          {/* Keyword input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={serpKeyword}
                onChange={(e) => setSerpKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeSerp()}
                placeholder="Enter keyword to analyze, e.g. 'content marketing tools'"
                className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>
            <button
              type="button"
              onClick={handleAnalyzeSerp}
              disabled={isAnalyzingSerp || !serpKeyword.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60 shrink-0"
            >
              {isAnalyzingSerp ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
              Analyze
            </button>
          </div>

          {serpMessage ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {serpMessage}
            </div>
          ) : null}

          {serpAnalyses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              No SERP analyses yet. Enter a keyword above and click Analyze to get an AI-powered insight report.
            </div>
          ) : (
            <div className="space-y-3">
              {serpAnalyses.map((analysis) => {
                const isExpanded = expandedSerp === analysis.id;
                return (
                  <div
                    key={analysis.id}
                    className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSerp(isExpanded ? null : analysis.id)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50">
                          <Search className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-[#121212]">{analysis.keyword}</p>
                          <p className="text-[11px] text-gray-400">
                            Analyzed {new Date(analysis.createdAt).toLocaleDateString()} ·{' '}
                            {serpCooldownHoursLeft(new Date(analysis.createdAt)) > 0
                              ? `Refresh in ${serpCooldownHoursLeft(new Date(analysis.createdAt))}h`
                              : 'Ready to refresh'}
                          </p>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-gray-100 px-4 py-4">
                        <div className="prose prose-sm max-w-none">
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800 font-sans">
                            {analysis.analysis}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

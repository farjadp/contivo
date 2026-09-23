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
import { useFormatter, useTranslations } from 'next-intl';
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

/* Keys and icons only; the labels come from the catalogue. */
const SEO_TABS: { key: SeoTab; icon: React.ReactNode }[] = [
  { key: 'competitor_keywords', icon: <Globe className="w-3.5 h-3.5" /> },
  { key: 'opportunities', icon: <Target className="w-3.5 h-3.5" /> },
  { key: 'serp_insights', icon: <Search className="w-3.5 h-3.5" /> },
];

/** Brand names stay Latin; isolating them keeps Persian punctuation in place. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

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

function competitionKey(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.7) return 'high';
  if (c >= 0.4) return 'medium';
  return 'low';
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
  const t = useTranslations('tabsB.seo');
  const format = useFormatter();
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
        setScanMessages((prev) => ({ ...prev, [domain]: result.reason ?? t('cooldownActive') }));
        return;
      }
      if ('error' in result && result.error) {
        setScanMessages((prev) => ({ ...prev, [domain]: t('errorPrefix', { message: result.error }) }));
        return;
      }
      // Reload page to pick up new data (lightweight full-page refresh)
      window.location.reload();
    } catch (e) {
      setScanMessages((prev) => ({ ...prev, [domain]: t('scanUnexpected') }));
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
          setOppsMessage(t('errorPrefix', { message: result.error }));
          return;
        }
        window.location.reload();
      } catch {
        setOppsMessage(t('computeFailed'));
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
          setSerpMessage(result.reason ?? t('cooldownActive'));
          // Even when skipped, we may have a cached analysis to show
          return;
        }
        if ('error' in result && result.error) {
          setSerpMessage(t('errorPrefix', { message: result.error }));
          return;
        }
        window.location.reload();
      } catch {
        setSerpMessage(t('serpFailed'));
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
          <h2 className="text-sm font-bold text-[#121212]">{t('title')}</h2>
          <p className="text-[11px] text-gray-500">{t.rich('subtitle', { bdi })}</p>
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
            {t(`tabs.${tab.key}`)}
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
              {t('noCompetitors')}
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
                          {/* Domains are raw data: never translated, always LTR. */}
                          <p className="text-xs font-bold text-[#121212] truncate max-w-[160px]" dir="ltr">{domain}</p>
                          {rowCount > 0 ? (
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {t('keywordsStored', { count: format.number(rowCount) })}
                            </p>
                          ) : (
                            <p className="text-[11px] text-gray-400 mt-0.5">{t('notScanned')}</p>
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
                          {selectedDomain === domain ? t('viewing') : t('view')}
                        </button>
                      </div>

                      {lastScan ? (
                        <p className="text-[11px] text-gray-500">
                          {t('lastScan', {
                            date: format.dateTime(new Date(lastScan), { dateStyle: 'medium' }),
                          })}
                          {daysLeft > 0
                            ? t('nextIn', { days: format.number(daysLeft) })
                            : t('readyToRescan')}
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
                          <><Loader2 className="w-3 h-3 animate-spin" /> {t('scanning')}</>
                        ) : rowCount > 0 ? (
                          <><RefreshCw className="w-3 h-3" /> {t('rescan')}</>
                        ) : (
                          <><Zap className="w-3 h-3" /> {t('scanKeywords')}</>
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
                      {t('keywordsFrom')}{' '}
                      <span className="text-indigo-600" dir="ltr">{selectedDomain}</span>
                    </h3>
                    <span className="text-[11px] text-gray-500">
                      {t('keywordCount', { count: format.number(selectedKeywords.length) })}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/30">
                          <th className="px-4 py-2.5 text-start font-bold text-gray-600">{t('colKeyword')}</th>
                          <th className="px-4 py-2.5 text-end font-bold text-gray-600">{t('colVolume')}</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">{t('colDifficulty')}</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">{t('colCompetition')}</th>
                          <th className="px-4 py-2.5 text-center font-bold text-gray-600">{t('colRank')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedKeywords.slice(0, 100).map((kw, idx) => (
                          <tr
                            key={kw.id}
                            className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                          >
                            <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[240px] truncate">
                              {/* Keywords are search data, never translated. */}
                              <bdi>{kw.keyword}</bdi>
                            </td>
                            <td className="px-4 py-2.5 text-end font-semibold text-gray-700">
                              {format.number(kw.searchVolume)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${difficultyColor(kw.difficulty)}`}>
                                {format.number(kw.difficulty)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${competitionColor(kw.competition)}`}>
                                {t(`competition.${competitionKey(kw.competition)}`)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center text-gray-500 font-medium">
                              {kw.rankingPosition === null
                                ? t('empty')
                                : format.number(kw.rankingPosition)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selectedKeywords.length > 100 ? (
                      <p className="px-4 py-3 text-[11px] text-gray-400">
                        {t('showingTop', {
                          shown: format.number(100),
                          total: format.number(selectedKeywords.length),
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : selectedDomain ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                  {t.rich('noKeywordsFor', {
                    domain: selectedDomain,
                    d: (chunks) => (
                      <strong dir="ltr">{chunks}</strong>
                    ),
                  })}
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
              {t('computeOpportunities')}
            </button>
            <p className="text-xs text-gray-500">{t('computeHelp')}</p>
          </div>

          {oppsMessage ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {oppsMessage}
            </div>
          ) : null}

          {opportunities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              {t('noOpportunities')}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-xs font-bold text-[#121212]">{t('topOpportunities')}</h3>
                <span className="text-[11px] text-gray-500">
                  {t('gapsFound', { count: format.number(opportunities.length) })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/30">
                      <th className="px-4 py-2.5 text-start font-bold text-gray-600">{t('colRow')}</th>
                      <th className="px-4 py-2.5 text-start font-bold text-gray-600">{t('colKeyword')}</th>
                      <th className="px-4 py-2.5 text-end font-bold text-gray-600">{t('colVolume')}</th>
                      <th className="px-4 py-2.5 text-center font-bold text-gray-600">{t('colCompetition')}</th>
                      <th className="px-4 py-2.5 text-start font-bold text-gray-600">{t('colScore')}</th>
                      <th className="px-4 py-2.5 text-start font-bold text-gray-600">{t('colSource')}</th>
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
                          <td className="px-4 py-2.5 font-bold text-gray-400">{format.number(idx + 1)}</td>
                          <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-[240px]">
                            <button
                              type="button"
                              onClick={() => {
                                setSerpKeyword(opp.keyword);
                                setActiveTab('serp_insights');
                              }}
                              className="hover:text-indigo-600 transition-colors text-start"
                              title={t('analyzeInSerp')}
                            >
                              <bdi>{opp.keyword}</bdi>
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-end font-semibold text-gray-700">
                            {format.number(opp.searchVolume)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${competitionColor(opp.competition)}`}>
                              {t(`competition.${competitionKey(opp.competition)}`)}
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
                              <span className="text-[10px] font-bold text-gray-600 w-8 text-end">
                                {format.number(opp.opportunityScore, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-gray-400 max-w-[120px] truncate">
                            <bdi>{opp.sourceCompetitor ?? t('empty')}</bdi>
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
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={serpKeyword}
                onChange={(e) => setSerpKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeSerp()}
                placeholder={t('serpPlaceholder')}
                className="w-full rounded-xl border border-gray-200 bg-white ps-9 pe-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>
            <button
              type="button"
              onClick={handleAnalyzeSerp}
              disabled={isAnalyzingSerp || !serpKeyword.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60 shrink-0"
            >
              {isAnalyzingSerp ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
              {t('analyze')}
            </button>
          </div>

          {serpMessage ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {serpMessage}
            </div>
          ) : null}

          {serpAnalyses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              {t('noSerp')}
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
                        <div className="text-start">
                          <p className="text-sm font-bold text-[#121212]"><bdi>{analysis.keyword}</bdi></p>
                          <p className="text-[11px] text-gray-400">
                            {t('analyzedOn', {
                              date: format.dateTime(new Date(analysis.createdAt), { dateStyle: 'medium' }),
                            })}
                            {serpCooldownHoursLeft(new Date(analysis.createdAt)) > 0
                              ? t('refreshIn', {
                                  hours: format.number(
                                    serpCooldownHoursLeft(new Date(analysis.createdAt)),
                                  ),
                                })
                              : t('readyToRefresh')}
                          </p>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        /* A chevron that points along the reading direction
                           has to turn around when the reading direction does. */
                        <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                      )}
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-gray-100 px-4 py-4">
                        <div className="prose prose-sm max-w-none">
                          <pre dir="auto" className="whitespace-pre-wrap text-start text-xs leading-relaxed text-gray-800 font-sans">
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

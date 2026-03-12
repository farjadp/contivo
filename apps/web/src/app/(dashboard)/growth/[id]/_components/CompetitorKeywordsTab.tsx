'use client';

import { useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { generateWorkspaceCompetitorKeywords } from '@/app/actions/growth-keywords';

type KeywordCluster = {
  cluster: string;
  keywords: string[];
};

type CompetitorKeywordIntel = {
  competitor: string;
  domain: string;
  primary_keywords: string[];
  secondary_keywords: string[];
  keyword_clusters: KeywordCluster[];
  intent_distribution: {
    informational: number;
    commercial: number;
    product: number;
    educational: number;
  };
  content_strategy: {
    main_goal: string;
    secondary_goals: string[];
    content_focus: string;
    publishing_style: string;
  };
  strategy_signals: {
    content_themes: string[];
    content_goal: string;
    funnel_distribution: {
      top_of_funnel: string[];
      middle_of_funnel: string[];
      bottom_of_funnel: string[];
    };
    content_formats: string[];
    strategic_strength: string;
    strategic_weakness: string;
  };
  data_quality_notes: string[];
};

type ContentGapOpportunity = {
  topic: string;
  competitor_weakness: string;
  audience_importance: string;
};

type KeywordHeatmapRow = {
  keyword: string;
  coverage: Record<string, boolean>;
};

type KeywordsPayload = {
  generated_at: string;
  source: 'AI' | 'MANUAL';
  ai_estimated: boolean;
  competitors: CompetitorKeywordIntel[];
  content_gaps: ContentGapOpportunity[];
  keyword_heatmap: {
    keywords: string[];
    rows: KeywordHeatmapRow[];
    competitor_domains: string[];
  };
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

const SECTION_TABS = [
  { key: 'top_keywords', label: 'Top Keywords' },
  { key: 'clusters', label: 'Keyword Clusters' },
  { key: 'strategy', label: 'Content Strategy Signals' },
  { key: 'gaps', label: 'Content Gaps' },
] as const;

type SectionKey = (typeof SECTION_TABS)[number]['key'];

export function CompetitorKeywordsTab({
  workspaceId,
  initialPayload,
}: {
  workspaceId: string;
  initialPayload: KeywordsPayload | null;
}) {
  const [payload, setPayload] = useState<KeywordsPayload | null>(initialPayload);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>('top_keywords');
  const [selectedDomain, setSelectedDomain] = useState<string>(
    initialPayload?.competitors?.[0]?.domain || '',
  );

  const selectedCompetitor = useMemo(() => {
    if (!payload || !selectedDomain) return null;
    return payload.competitors.find((item) => item.domain === selectedDomain) || null;
  }, [payload, selectedDomain]);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateWorkspaceCompetitorKeywords(workspaceId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.payload) {
        const next = result.payload as KeywordsPayload;
        setPayload(next);
        setSelectedDomain(next.competitors?.[0]?.domain || '');
        setSuccess('Competitor keyword intelligence generated from competitor content signals.');
      }
    } catch (generateError) {
      console.error(generateError);
      setError('Unexpected error while generating competitor keyword analysis.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 rounded-xl bg-[#121212] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60"
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-emerald-400" />}
          Analyze Competitor Keywords
        </button>

        {payload?.competitors?.length ? (
          <select
            value={selectedDomain}
            onChange={(event) => setSelectedDomain(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            {payload.competitors.map((competitor) => (
              <option key={competitor.domain} value={competitor.domain}>
                {competitor.competitor} ({competitor.domain})
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
        AI-estimated, based on public competitor pages and visible signals. Review before decisions.
      </div>

      {payload?.token_usage ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Last Keyword Run Tokens</p>
            {payload.token_usage.last_run ? (
              <div className="mt-2 space-y-1 text-sm text-gray-700">
                <p>
                  Prompt: <span className="font-semibold">{payload.token_usage.last_run.prompt_tokens.toLocaleString()}</span>
                </p>
                <p>
                  Completion:{' '}
                  <span className="font-semibold">{payload.token_usage.last_run.completion_tokens.toLocaleString()}</span>
                </p>
                <p>
                  Total: <span className="font-semibold">{payload.token_usage.last_run.total_tokens.toLocaleString()}</span>
                </p>
                <p className="text-xs text-gray-500">
                  Model: {payload.token_usage.last_run.model} |{' '}
                  {new Date(payload.token_usage.last_run.created_at).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">No token data yet.</p>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Lifetime Keyword Tokens</p>
            <div className="mt-2 space-y-1 text-sm text-gray-700">
              <p>
                Runs: <span className="font-semibold">{payload.token_usage.runs.toLocaleString()}</span>
              </p>
              <p>
                Prompt: <span className="font-semibold">{payload.token_usage.lifetime_prompt_tokens.toLocaleString()}</span>
              </p>
              <p>
                Completion:{' '}
                <span className="font-semibold">{payload.token_usage.lifetime_completion_tokens.toLocaleString()}</span>
              </p>
              <p>
                Total: <span className="font-semibold">{payload.token_usage.lifetime_total_tokens.toLocaleString()}</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{success}</div>
      ) : null}

      {!payload || payload.competitors.length === 0 || !selectedCompetitor ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-sm text-gray-500">
          No keyword intelligence yet. Run analysis to extract competitor keywords, clusters, strategy signals, and gaps.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSection(tab.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  section === tab.key
                    ? 'border-[#121212] bg-[#121212] text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {section === 'top_keywords' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Primary Keywords</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompetitor.primary_keywords.map((keyword) => (
                    <span key={keyword} className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Secondary Keywords</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompetitor.secondary_keywords.map((keyword) => (
                    <span key={keyword} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Intent Distribution</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <IntentCard label="Informational" value={selectedCompetitor.intent_distribution.informational} />
                  <IntentCard label="Commercial" value={selectedCompetitor.intent_distribution.commercial} />
                  <IntentCard label="Product" value={selectedCompetitor.intent_distribution.product} />
                  <IntentCard label="Educational" value={selectedCompetitor.intent_distribution.educational} />
                </div>
              </div>
            </div>
          ) : null}

          {section === 'clusters' ? (
            <div className="grid gap-3 md:grid-cols-2">
              {selectedCompetitor.keyword_clusters.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
                  No clusters extracted.
                </div>
              ) : (
                selectedCompetitor.keyword_clusters.map((cluster) => (
                  <div key={cluster.cluster} className="rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-[#121212]">{cluster.cluster}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {cluster.keywords.map((keyword) => (
                        <span key={`${cluster.cluster}:${keyword}`} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {section === 'strategy' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Content Strategy</h3>
                <p className="mt-2 text-sm text-gray-700">
                  <span className="font-semibold">Main Goal:</span> {selectedCompetitor.content_strategy.main_goal || 'n/a'}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  <span className="font-semibold">Content Focus:</span> {selectedCompetitor.content_strategy.content_focus || 'n/a'}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  <span className="font-semibold">Publishing Style:</span> {selectedCompetitor.content_strategy.publishing_style || 'n/a'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompetitor.content_strategy.secondary_goals.map((goal) => (
                    <span key={goal} className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {goal}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Main Content Themes</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompetitor.strategy_signals.content_themes.map((theme) => (
                    <span key={theme} className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                      {theme}
                    </span>
                  ))}
                </div>
                <h4 className="mt-4 text-xs font-bold uppercase tracking-widest text-gray-500">Formats</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedCompetitor.strategy_signals.content_formats.map((format) => (
                    <span key={format} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
                      {format}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Content Funnel</h3>
                <FunnelBlock label="Top of Funnel" items={selectedCompetitor.strategy_signals.funnel_distribution.top_of_funnel} />
                <FunnelBlock label="Middle of Funnel" items={selectedCompetitor.strategy_signals.funnel_distribution.middle_of_funnel} />
                <FunnelBlock label="Bottom of Funnel" items={selectedCompetitor.strategy_signals.funnel_distribution.bottom_of_funnel} />
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Strength vs Weakness</h3>
                <p className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <span className="font-semibold">Strength:</span> {selectedCompetitor.strategy_signals.strategic_strength || 'n/a'}
                </p>
                <p className="mt-2 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                  <span className="font-semibold">Weakness:</span> {selectedCompetitor.strategy_signals.strategic_weakness || 'n/a'}
                </p>
                {selectedCompetitor.data_quality_notes.length > 0 ? (
                  <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {selectedCompetitor.data_quality_notes.join(' | ')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {section === 'gaps' ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {payload.content_gaps.map((gap) => (
                  <div key={`${gap.topic}:${gap.competitor_weakness}`} className="rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-[#121212]">{gap.topic}</h3>
                    <p className="mt-2 text-sm text-gray-700">
                      <span className="font-semibold">Competitor weakness:</span> {gap.competitor_weakness}
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      <span className="font-semibold">Why it matters:</span> {gap.audience_importance}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">Keyword Overlap Heatmap</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-600">
                          Keyword
                        </th>
                        {payload.keyword_heatmap.competitor_domains.map((domain) => (
                          <th key={domain} className="border border-gray-200 bg-gray-50 px-3 py-2 text-center font-bold text-gray-600">
                            {domain}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {payload.keyword_heatmap.rows.map((row) => (
                        <tr key={row.keyword}>
                          <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{row.keyword}</td>
                          {payload.keyword_heatmap.competitor_domains.map((domain) => (
                            <td key={`${row.keyword}:${domain}`} className="border border-gray-200 px-3 py-2 text-center">
                              {row.coverage[domain] ? '✔' : '✖'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function IntentCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#121212]">{value}%</p>
    </div>
  );
}

function FunnelBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-widest text-gray-500">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-gray-400">No clear signals.</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={`${label}:${item}`} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

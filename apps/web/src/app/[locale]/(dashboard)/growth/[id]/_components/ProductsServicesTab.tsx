'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Info,
  Layers3,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {
  generateWorkspaceProductsServicesIntel,
  saveWorkspaceProductsServicesIntelEdits,
} from '@/app/actions/growth-offerings';

type OfferingItem = {
  name: string;
  normalized_name: string;
  type: 'product' | 'service' | 'solution' | 'platform_module' | 'package';
  description: string;
  target_audience: string;
  problem_solved: string;
  value_proposition: string;
  source_pages: string[];
  related_keywords: string[];
  aliases: string[];
  pricing_signal: string;
  feature_signal: string;
  cta_signal: string;
  confidence_score: number;
};

type CompanyOfferings = {
  company_name: string;
  website: string;
  offerings: OfferingItem[];
  summary: {
    offering_count: number;
    main_business_model_guess: string;
    main_offering_focus: string;
    primary_offering: string;
    secondary_offering: string;
    core_revenue_model_guess: string;
    main_positioning_angle: string;
    main_offer_focus: string;
    product_service_ratio: string;
  };
};

type ProductsServicesPayload = {
  generated_at: string;
  source: 'AI' | 'MANUAL';
  ai_estimated: boolean;
  client_offerings: CompanyOfferings;
  competitor_offerings: Array<{
    competitor_name: string;
    website: string;
    offerings: OfferingItem[];
    summary: CompanyOfferings['summary'];
  }>;
  comparison_summary: {
    client_focus: string;
    competitor_patterns: string[];
    white_space_opportunities: string[];
    offer_clarity_insight: string;
    market_offer_pattern: string;
    offer_gap_opportunity: string;
  };
  comparison_analysis: {
    common_market_offerings: string[];
    client_unique_offerings: string[];
    competitor_common_offerings: string[];
    client_missing_offerings: string[];
    positioning_insight: string;
    offer_gap_opportunity: string;
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

const TABS = [
  { key: 'client', label: 'Client Offerings' },
  { key: 'competitors', label: 'Competitor Offerings' },
  { key: 'comparison', label: 'Offer Comparison' },
  { key: 'gaps', label: 'Offer Gaps' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.55;
  return Math.max(0.3, Math.min(1, value));
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function createEmptyOffering(): OfferingItem {
  return {
    name: '',
    normalized_name: '',
    type: 'product',
    description: '',
    target_audience: '',
    problem_solved: '',
    value_proposition: '',
    source_pages: [],
    related_keywords: [],
    aliases: [],
    pricing_signal: '',
    feature_signal: '',
    cta_signal: '',
    confidence_score: 0.55,
  };
}

function matchOffering(item: OfferingItem, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    item.normalized_name.toLowerCase().includes(q) ||
    item.problem_solved.toLowerCase().includes(q) ||
    item.value_proposition.toLowerCase().includes(q)
  );
}

export function ProductsServicesTab({
  workspaceId,
  initialPayload,
}: {
  workspaceId: string;
  initialPayload: ProductsServicesPayload | null;
}) {
  const [payload, setPayload] = useState<ProductsServicesPayload | null>(initialPayload);
  const [tab, setTab] = useState<TabKey>('client');
  const [selectedCompetitor, setSelectedCompetitor] = useState<string>(
    initialPayload?.competitor_offerings?.[0]?.website || '',
  );
  const [clientQuery, setClientQuery] = useState('');
  const [competitorQuery, setCompetitorQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedCompetitorData = useMemo(() => {
    if (!payload || !selectedCompetitor) return null;
    return payload.competitor_offerings.find((item) => item.website === selectedCompetitor) || null;
  }, [payload, selectedCompetitor]);

  const filteredClientOfferings = useMemo(() => {
    if (!payload) return [];
    return payload.client_offerings.offerings
      .map((offering, index) => ({ offering, index }))
      .filter((item) => matchOffering(item.offering, clientQuery));
  }, [payload, clientQuery]);

  const filteredCompetitorOfferings = useMemo(() => {
    if (!selectedCompetitorData) return [];
    return selectedCompetitorData.offerings
      .map((offering, index) => ({ offering, index }))
      .filter((item) => matchOffering(item.offering, competitorQuery));
  }, [selectedCompetitorData, competitorQuery]);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateWorkspaceProductsServicesIntel(workspaceId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.payload) {
        const next = result.payload as ProductsServicesPayload;
        setPayload(next);
        setSelectedCompetitor(next.competitor_offerings?.[0]?.website || '');
        setClientQuery('');
        setCompetitorQuery('');
        setSuccess('Products & Services intelligence generated and saved.');
      }
    } catch (generateError) {
      console.error(generateError);
      setError('Unexpected error while generating offerings intelligence.');
    } finally {
      setIsGenerating(false);
    }
  };

  const save = async () => {
    if (!payload) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await saveWorkspaceProductsServicesIntelEdits(workspaceId, payload);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.payload) {
        setPayload(result.payload as ProductsServicesPayload);
        setSuccess('Products & Services edits saved.');
      }
    } catch (saveError) {
      console.error(saveError);
      setError('Unexpected error while saving offerings intelligence edits.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateClientOffering = (index: number, patch: Partial<OfferingItem>) => {
    if (!payload) return;
    const next = payload.client_offerings.offerings.map((item, idx) =>
      idx === index
        ? {
            ...item,
            ...patch,
            normalized_name:
              patch.normalized_name ??
              (typeof patch.name === 'string' ? normalizeName(patch.name) : item.normalized_name),
          }
        : item,
    );
    setPayload({
      ...payload,
      client_offerings: {
        ...payload.client_offerings,
        offerings: next,
      },
    });
  };

  const updateCompetitorOffering = (
    competitorWebsite: string,
    offeringIndex: number,
    patch: Partial<OfferingItem>,
  ) => {
    if (!payload) return;
    setPayload({
      ...payload,
      competitor_offerings: payload.competitor_offerings.map((competitor) => {
        if (competitor.website !== competitorWebsite) return competitor;
        return {
          ...competitor,
          offerings: competitor.offerings.map((offering, idx) =>
            idx === offeringIndex
              ? {
                  ...offering,
                  ...patch,
                  normalized_name:
                    patch.normalized_name ??
                    (typeof patch.name === 'string'
                      ? normalizeName(patch.name)
                      : offering.normalized_name),
                }
              : offering,
          ),
        };
      }),
    });
  };

  const addClientOffering = () => {
    if (!payload) return;
    const nextOfferings = [...payload.client_offerings.offerings, createEmptyOffering()];
    setPayload({
      ...payload,
      client_offerings: {
        ...payload.client_offerings,
        offerings: nextOfferings,
        summary: {
          ...payload.client_offerings.summary,
          offering_count: nextOfferings.length,
        },
      },
    });
  };

  const removeClientOffering = (index: number) => {
    if (!payload) return;
    const nextOfferings = payload.client_offerings.offerings.filter((_, idx) => idx !== index);
    setPayload({
      ...payload,
      client_offerings: {
        ...payload.client_offerings,
        offerings: nextOfferings,
        summary: {
          ...payload.client_offerings.summary,
          offering_count: nextOfferings.length,
        },
      },
    });
  };

  const addCompetitorOffering = (competitorWebsite: string) => {
    if (!payload) return;
    setPayload({
      ...payload,
      competitor_offerings: payload.competitor_offerings.map((competitor) => {
        if (competitor.website !== competitorWebsite) return competitor;
        const nextOfferings = [...competitor.offerings, createEmptyOffering()];
        return {
          ...competitor,
          offerings: nextOfferings,
          summary: {
            ...competitor.summary,
            offering_count: nextOfferings.length,
          },
        };
      }),
    });
  };

  const removeCompetitorOffering = (competitorWebsite: string, offeringIndex: number) => {
    if (!payload) return;
    setPayload({
      ...payload,
      competitor_offerings: payload.competitor_offerings.map((competitor) => {
        if (competitor.website !== competitorWebsite) return competitor;
        const nextOfferings = competitor.offerings.filter((_, idx) => idx !== offeringIndex);
        return {
          ...competitor,
          offerings: nextOfferings,
          summary: {
            ...competitor.summary,
            offering_count: nextOfferings.length,
          },
        };
      }),
    });
  };

  const comparisonRows = useMemo(() => {
    if (!payload) return [];

    const allNames = new Set<string>();
    for (const offering of payload.client_offerings.offerings) {
      allNames.add(offering.normalized_name || offering.name.toLowerCase());
    }
    for (const competitor of payload.competitor_offerings) {
      for (const offering of competitor.offerings) {
        allNames.add(offering.normalized_name || offering.name.toLowerCase());
      }
    }

    const rows = [...allNames].slice(0, 80);
    return rows.map((name) => ({
      name,
      client: payload.client_offerings.offerings.some(
        (offering) => (offering.normalized_name || offering.name.toLowerCase()) === name,
      ),
      competitors: payload.competitor_offerings.map((competitor) => ({
        website: competitor.website,
        has: competitor.offerings.some(
          (offering) => (offering.normalized_name || offering.name.toLowerCase()) === name,
        ),
      })),
    }));
  }, [payload]);

  const tabCountMap = {
    client: payload?.client_offerings.offerings.length || 0,
    competitors: payload?.competitor_offerings.length || 0,
    comparison: comparisonRows.length,
    gaps:
      (payload?.comparison_summary.white_space_opportunities.length || 0) +
      (payload?.comparison_summary.competitor_patterns.length || 0),
  } satisfies Record<TabKey, number>;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
              <Layers3 className="h-3.5 w-3.5" />
              Products & Services Intelligence
            </p>
            <h3 className="text-lg font-bold text-[#121212]">Structured Offer Mapping</h3>
            <p className="max-w-2xl text-sm text-gray-600">
              Discover offerings from client and competitors, then review and edit them in a cleaner,
              comparison-ready workspace.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-xl bg-[#121212] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 text-emerald-400" />
              )}
              Analyze
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isSaving || !payload}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-[#121212] transition hover:bg-gray-50 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Edits
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricTile
            icon={<Building2 className="h-4 w-4" />}
            label="Client Offerings"
            value={String(payload?.client_offerings.offerings.length || 0)}
          />
          <MetricTile
            icon={<Layers3 className="h-4 w-4" />}
            label="Competitors"
            value={String(payload?.competitor_offerings.length || 0)}
          />
          <MetricTile
            icon={<Info className="h-4 w-4" />}
            label="Last Run Tokens"
            value={String(payload?.token_usage.last_run?.total_tokens?.toLocaleString() || 0)}
          />
          <MetricTile
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Lifetime Tokens"
            value={String(payload?.token_usage.lifetime_total_tokens?.toLocaleString() || 0)}
          />
        </div>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
        AI-estimated based on public signals. Review and confirm before strategic decisions.
      </div>

      {payload?.token_usage ? (
        <div className="grid gap-3 md:grid-cols-2">
          <TokenCard
            title="Last Run Usage"
            rows={[
              ['Prompt', payload.token_usage.last_run?.prompt_tokens || 0],
              ['Completion', payload.token_usage.last_run?.completion_tokens || 0],
              ['Total', payload.token_usage.last_run?.total_tokens || 0],
            ]}
            footer={
              payload.token_usage.last_run
                ? `Model: ${payload.token_usage.last_run.model} | ${new Date(
                    payload.token_usage.last_run.created_at,
                  ).toLocaleString()}`
                : 'No token data yet.'
            }
          />
          <TokenCard
            title="Lifetime Usage"
            rows={[
              ['Runs', payload.token_usage.runs],
              ['Prompt', payload.token_usage.lifetime_prompt_tokens],
              ['Completion', payload.token_usage.lifetime_completion_tokens],
              ['Total', payload.token_usage.lifetime_total_tokens],
            ]}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </span>
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {success}
          </span>
        </div>
      ) : null}

      {!payload ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-[#121212]">No intelligence generated yet.</p>
          <p className="mt-1 text-sm text-gray-500">
            Run analysis to build the client and competitor offerings dataset.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-1.5">
            <div className="flex flex-wrap gap-1">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    tab === item.key
                      ? 'bg-[#121212] text-white'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      tab === item.key ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tabCountMap[item.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {tab === 'client' ? (
            <div className="space-y-4">
              <SummaryCard
                title={`${payload.client_offerings.company_name} Summary`}
                summary={payload.client_offerings.summary}
              />
              <ListToolbar
                searchValue={clientQuery}
                onSearchChange={setClientQuery}
                searchPlaceholder="Search client offerings"
                addLabel="Add Client Offering"
                onAdd={addClientOffering}
              />
              {filteredClientOfferings.length === 0 ? (
                <EmptyListMessage message="No client offerings match your search." />
              ) : (
                <div className="space-y-3">
                  {filteredClientOfferings.map(({ offering, index }, visualIndex) => (
                    <OfferingEditorCard
                      key={`client:${offering.normalized_name}:${index}`}
                      offering={offering}
                      order={visualIndex + 1}
                      onChange={(patch) => updateClientOffering(index, patch)}
                      onRemove={() => removeClientOffering(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === 'competitors' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">
                  Select Competitor
                </label>
                <select
                  value={selectedCompetitor}
                  onChange={(event) => setSelectedCompetitor(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
                >
                  {payload.competitor_offerings.map((competitor) => (
                    <option key={competitor.website} value={competitor.website}>
                      {competitor.competitor_name} ({competitor.website.replace(/^https?:\/\//, '')})
                    </option>
                  ))}
                </select>
              </div>

              {selectedCompetitorData ? (
                <>
                  <SummaryCard
                    title={`${selectedCompetitorData.competitor_name} Summary`}
                    summary={selectedCompetitorData.summary}
                  />
                  <ListToolbar
                    searchValue={competitorQuery}
                    onSearchChange={setCompetitorQuery}
                    searchPlaceholder="Search competitor offerings"
                    addLabel="Add Competitor Offering"
                    onAdd={() => addCompetitorOffering(selectedCompetitorData.website)}
                  />
                  {filteredCompetitorOfferings.length === 0 ? (
                    <EmptyListMessage message="No competitor offerings match your search." />
                  ) : (
                    <div className="space-y-3">
                      {filteredCompetitorOfferings.map(({ offering, index }, visualIndex) => (
                        <OfferingEditorCard
                          key={`${selectedCompetitorData.website}:${offering.normalized_name}:${index}`}
                          offering={offering}
                          order={visualIndex + 1}
                          onChange={(patch) =>
                            updateCompetitorOffering(selectedCompetitorData.website, index, patch)
                          }
                          onRemove={() =>
                            removeCompetitorOffering(selectedCompetitorData.website, index)
                          }
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <EmptyListMessage message="No competitor offering data." />
              )}
            </div>
          ) : null}

          {tab === 'comparison' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#121212]">
                  Offer Comparison Matrix
                </h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-600">
                          Offering
                        </th>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center font-bold text-gray-600">
                          Client
                        </th>
                        {payload.competitor_offerings.map((competitor) => (
                          <th
                            key={competitor.website}
                            className="border border-gray-200 bg-gray-50 px-3 py-2 text-center font-bold text-gray-600"
                          >
                            {competitor.competitor_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.name} className="odd:bg-white even:bg-gray-50/40">
                          <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">
                            {row.name}
                          </td>
                          <td className="border border-gray-200 px-3 py-2 text-center">
                            {row.client ? '✔' : '✖'}
                          </td>
                          {row.competitors.map((competitor) => (
                            <td
                              key={`${row.name}:${competitor.website}`}
                              className="border border-gray-200 px-3 py-2 text-center"
                            >
                              {competitor.has ? '✔' : '✖'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ListCard
                  title="Common Market Offerings"
                  items={payload.comparison_analysis.common_market_offerings}
                />
                <ListCard
                  title="Client Unique Offerings"
                  items={payload.comparison_analysis.client_unique_offerings}
                />
                <ListCard
                  title="Competitor Common Offerings"
                  items={payload.comparison_analysis.competitor_common_offerings}
                />
                <ListCard
                  title="Client Missing Offerings"
                  items={payload.comparison_analysis.client_missing_offerings}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <InsightCard
                  title="Positioning Insight"
                  value={payload.comparison_analysis.positioning_insight}
                />
                <InsightCard
                  title="Offer Gap Opportunity"
                  value={payload.comparison_analysis.offer_gap_opportunity}
                  highlight
                />
              </div>
            </div>
          ) : null}

          {tab === 'gaps' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <InsightCard title="Offer Clarity Insight" value={payload.comparison_summary.offer_clarity_insight} />
              <InsightCard title="Market Offer Pattern" value={payload.comparison_summary.market_offer_pattern} />
              <InsightCard title="Client Focus" value={payload.comparison_summary.client_focus} />
              <InsightCard title="Offer Gap Opportunity" value={payload.comparison_summary.offer_gap_opportunity} highlight />
              <ListCard title="Competitor Patterns" items={payload.comparison_summary.competitor_patterns} />
              <ListCard
                title="White Space Opportunities"
                items={payload.comparison_summary.white_space_opportunities}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-[#121212]">{value}</p>
    </div>
  );
}

function TokenCard({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: Array<[string, number]>;
  footer?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</p>
      <div className="mt-2 space-y-1 text-sm text-gray-700">
        {rows.map(([key, value]) => (
          <p key={`${title}:${key}`}>
            {key}: <span className="font-semibold">{value.toLocaleString()}</span>
          </p>
        ))}
      </div>
      {footer ? <p className="mt-2 text-xs text-gray-500">{footer}</p> : null}
    </div>
  );
}

function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  addLabel,
  onAdd,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
      <div className="relative w-full md:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-700 focus:border-black focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

function EmptyListMessage({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

function SummaryCard({ title, summary }: { title: string; summary: CompanyOfferings['summary'] }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-bold text-[#121212]">{title}</h3>
      <div className="mt-3 grid gap-2 text-sm text-gray-700 md:grid-cols-3">
        <SummaryRow label="Main Model" value={summary.main_business_model_guess} />
        <SummaryRow label="Main Focus" value={summary.main_offering_focus} />
        <SummaryRow label="Primary Offer" value={summary.primary_offering} />
        <SummaryRow label="Secondary Offer" value={summary.secondary_offering} />
        <SummaryRow label="Revenue Model" value={summary.core_revenue_model_guess} />
        <SummaryRow label="Product/Service Ratio" value={summary.product_service_ratio} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-800">{value || 'n/a'}</p>
    </div>
  );
}

function OfferingEditorCard({
  offering,
  order,
  onChange,
  onRemove,
}: {
  offering: OfferingItem;
  order: number;
  onChange: (patch: Partial<OfferingItem>) => void;
  onRemove: () => void;
}) {
  const title = offering.name.trim() || `Untitled Offering ${order}`;
  const normalized = offering.normalized_name || normalizeName(offering.name || title);

  return (
    <details className="rounded-2xl border border-gray-200 bg-white" open={order <= 1}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#121212]">{title}</p>
          <p className="truncate text-xs text-gray-500">{normalized || 'normalized_name pending'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
            {offering.type}
          </span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            {offering.confidence_score.toFixed(2)}
          </span>
        </div>
      </summary>

      <div className="border-t border-gray-100 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Offering Name">
            <input
              value={offering.name}
              onChange={(event) => onChange({ name: event.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              placeholder="e.g. AI Strategy Engine"
            />
          </Field>

          <Field label="Type">
            <select
              value={offering.type}
              onChange={(event) => onChange({ type: event.target.value as OfferingItem['type'] })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            >
              <option value="product">product</option>
              <option value="service">service</option>
              <option value="solution">solution</option>
              <option value="platform_module">platform_module</option>
              <option value="package">package</option>
            </select>
          </Field>

          <Field label="Description" full>
            <textarea
              value={offering.description}
              onChange={(event) => onChange({ description: event.target.value })}
              className="h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              placeholder="Neutral description of this offer and who it serves."
            />
          </Field>

          <Field label="Problem Solved">
            <textarea
              value={offering.problem_solved}
              onChange={(event) => onChange({ problem_solved: event.target.value })}
              className="h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              placeholder="What exact problem this offer solves"
            />
          </Field>

          <Field label="Value Proposition">
            <textarea
              value={offering.value_proposition}
              onChange={(event) => onChange({ value_proposition: event.target.value })}
              className="h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              placeholder="Core value this offer delivers"
            />
          </Field>

          <Field label="Confidence (0.30 - 1.00)">
            <input
              type="number"
              min={0.3}
              max={1}
              step={0.01}
              value={Number(offering.confidence_score.toFixed(2))}
              onChange={(event) =>
                onChange({ confidence_score: clampConfidence(Number(event.target.value)) })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-700">Signals</p>
          <p className="mt-1">Source Pages: {offering.source_pages.join(', ') || 'n/a'}</p>
          <p>Aliases: {offering.aliases.join(', ') || 'n/a'}</p>
          <p>Related Keywords: {offering.related_keywords.join(', ') || 'n/a'}</p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Keep <span className="font-semibold">name</span>, <span className="font-semibold">type</span>,{' '}
            <span className="font-semibold">description</span>, and{' '}
            <span className="font-semibold">problem solved</span> accurate.
          </p>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    </details>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={full ? 'space-y-1.5 md:col-span-2' : 'space-y-1.5'}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No data.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {items.map((item) => (
            <li key={`${title}:${item}`} className="rounded-md bg-gray-50 px-2.5 py-1.5">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? 'border-indigo-100 bg-indigo-50' : 'border-gray-200 bg-white'
      }`}
    >
      <p
        className={`text-xs font-bold uppercase tracking-widest ${
          highlight ? 'text-indigo-700' : 'text-gray-500'
        }`}
      >
        {title}
      </p>
      <p className={`mt-1 text-sm ${highlight ? 'text-indigo-900' : 'text-gray-700'}`}>{value || 'n/a'}</p>
    </div>
  );
}

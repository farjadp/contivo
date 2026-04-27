'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plus, Save, Sparkles, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  discoverWorkspaceCompetitors,
  saveWorkspaceCompetitorEdits,
} from '@/app/actions/growth-competitors';

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

type CompetitiveMatrixPayload = {
  generated_at: string;
  ai_estimated: boolean;
  source: 'AI' | 'MANUAL';
  charts: Array<{
    chart_key: string;
    chart_name: string;
    axes: { x: string; y: string };
    companies: Array<{
      name: string;
      website: string;
      type: 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL' | 'TARGET';
      x_score: number;
      y_score: number;
      x_reason: string;
      y_reason: string;
      confidence_score: number;
    }>;
    summary: {
      market_pattern: string;
      positioning_opportunity: string;
    };
  }>;
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

function isSyntheticCompetitor(item: { name?: string | null; domain?: string | null }): boolean {
  const name = String(item.name || '').toLowerCase().trim();
  const domain = String(item.domain || '').toLowerCase().trim();
  const syntheticNames = ['nova labs', 'pulse works', 'axis growth', 'summit metrics', 'clarity forge'];

  if (!name && !domain) return true;
  if (syntheticNames.includes(name)) return true;
  if (/^market\d+\.com$/.test(domain)) return true;

  return false;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeKeywordScore(text: string, rules: Array<{ pattern: RegExp; delta: number }>, initial = 50): number {
  return rules.reduce((score, rule) => (rule.pattern.test(text) ? score + rule.delta : score), initial);
}

function estimateAudienceSizeScore(item: CompetitorItem): number {
  const text = `${item.name} ${item.domain || ''} ${item.description || ''} ${item.category || ''} ${item.audienceGuess || ''}`.toLowerCase();

  let score = computeKeywordScore(
    text,
    [
      { pattern: /\b(enterprise|global|fortune|mid[-\s]?market)\b/, delta: 14 },
      { pattern: /\b(platform|marketplace|network|suite|all[-\s]?in[-\s]?one)\b/, delta: 9 },
      { pattern: /\b(smb|small business|startup|local|niche)\b/, delta: -10 },
      { pattern: /\b(agency|boutique|consulting|freelance)\b/, delta: -8 },
      { pattern: /\b(consumer|b2c|mass market)\b/, delta: 6 },
    ],
    50,
  );

  if (item.type === 'INDIRECT') score += 4;
  if (item.type === 'ASPIRATIONAL') score += 7;

  return clamp(score, 10, 90);
}

function estimateSophisticationScore(item: CompetitorItem): number {
  const text = `${item.name} ${item.domain || ''} ${item.description || ''} ${item.category || ''}`.toLowerCase();

  let score = computeKeywordScore(
    text,
    [
      { pattern: /\b(ai|machine learning|predictive|automation|workflow)\b/, delta: 14 },
      { pattern: /\b(api|infrastructure|platform|analytics|orchestration)\b/, delta: 10 },
      { pattern: /\b(enterprise|security|compliance|integrations?)\b/, delta: 8 },
      { pattern: /\b(agency|service|consulting|done[-\s]?for[-\s]?you)\b/, delta: -9 },
      { pattern: /\b(template|simple|starter|basic)\b/, delta: -7 },
    ],
    50,
  );

  if (item.type === 'ASPIRATIONAL') score += 10;
  if (item.type === 'INDIRECT') score -= 3;

  return clamp(score, 10, 90);
}

function computeCompetitorPoint(item: CompetitorItem): { x: number; y: number; distanceToBrand: number } {
  const audienceScore = estimateAudienceSizeScore(item);
  const sophisticationScore = estimateSophisticationScore(item);
  const seed = `${item.id}:${item.name}:${item.domain || ''}`;
  const jitter = ((hashString(seed) % 7) - 3) * 0.8;

  const x = clamp(audienceScore + jitter, 12, 88);
  const y = clamp(100 - sophisticationScore + jitter, 12, 88);
  const distanceToBrand = Math.sqrt((x - 50) ** 2 + (y - 50) ** 2);

  return { x, y, distanceToBrand };
}

function getTypeStyles(type?: string | null): string {
  if (type === 'DIRECT') return 'bg-rose-500 border-rose-200';
  if (type === 'INDIRECT') return 'bg-amber-400 border-amber-200';
  return 'bg-emerald-400 border-emerald-200';
}

export function CompetitorMapManager({
  workspaceId,
  initialCompetitors,
  initialMeta,
  initialArchive,
  onMatricesUpdated,
}: {
  workspaceId: string;
  initialCompetitors: CompetitorItem[];
  initialMeta?: DiscoveryMeta;
  initialArchive?: DiscoveryArchiveItem[];
  onMatricesUpdated?: (matrices: CompetitiveMatrixPayload | null) => void;
}) {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<CompetitorItem[]>(
    initialCompetitors
      .filter((item) => !isSyntheticCompetitor(item))
      .map((item) => ({
        ...item,
        type: item.type || 'DIRECT',
        userDecision: item.userDecision || (item.source === 'AI' ? 'PENDING' : 'ACCEPTED'),
      })),
  );
  const [manualName, setManualName] = useState('');
  const [manualDomain, setManualDomain] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [discoveryMeta, setDiscoveryMeta] = useState<DiscoveryMeta>(
    initialMeta || { usedRuns: 0, remainingRuns: 3, maxRuns: 3 },
  );
  const [discoveryArchive, setDiscoveryArchive] = useState<DiscoveryArchiveItem[]>(
    initialArchive || [],
  );

  const visibleCompetitors = useMemo(
    () =>
      competitors.filter(
        (item) => item.userDecision !== 'REJECTED' && !isSyntheticCompetitor(item),
      ),
    [competitors],
  );
  const acceptedCount = useMemo(
    () => competitors.filter((item) => item.userDecision === 'ACCEPTED').length,
    [competitors],
  );
  const positionedCompetitors = useMemo(
    () =>
      visibleCompetitors
        .map((item) => ({ ...item, point: computeCompetitorPoint(item) }))
        .sort((a, b) => a.point.distanceToBrand - b.point.distanceToBrand),
    [visibleCompetitors],
  );
  const topCompetitors = useMemo(() => positionedCompetitors.slice(0, 10), [positionedCompetitors]);

  const updateCompetitor = (id: string, patch: Partial<CompetitorItem>) => {
    setCompetitors((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addManualCompetitor = () => {
    const name = manualName.trim();
    const domain = manualDomain.trim();
    if (!name && !domain) return;

    const inferredName = name || domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] || 'Manual Competitor';
    const id = `temp-${Date.now()}`;

    setCompetitors((prev) => [
      ...prev,
      {
        id,
        name: inferredName,
        domain: domain || null,
        description: 'Manually added competitor',
        category: null,
        audienceGuess: null,
        type: 'DIRECT',
        userDecision: 'ACCEPTED',
        source: 'MANUAL',
      },
    ]);

    setManualName('');
    setManualDomain('');
    setError(null);
    setSuccess(null);
  };

  const runAiDiscovery = async () => {
    setIsDiscovering(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await discoverWorkspaceCompetitors(workspaceId);
      if (result?.meta) {
        setDiscoveryMeta(result.meta);
      }
      if (Array.isArray(result?.archive)) {
        setDiscoveryArchive(result.archive);
      }

      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.competitors) {
        setCompetitors(
          result.competitors
            .filter((item: CompetitorItem) => !isSyntheticCompetitor(item))
            .map((item: CompetitorItem) => ({
              ...item,
              type: item.type || 'DIRECT',
              userDecision: item.userDecision || (item.source === 'AI' ? 'PENDING' : 'ACCEPTED'),
            })),
        );
        setSuccess(
          result.message ||
            'We found potential competitors for your business. Please review and confirm them.',
        );
        router.refresh();
      }
    } catch (discoverError) {
      console.error(discoverError);
      setError('Unexpected error while discovering competitors.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const saveEdits = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await saveWorkspaceCompetitorEdits(workspaceId, competitors);
      if (result?.meta) {
        setDiscoveryMeta(result.meta);
      }
      if (Array.isArray(result?.archive)) {
        setDiscoveryArchive(result.archive);
      }

      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.competitors) {
        setCompetitors(
          result.competitors
            .filter((item: CompetitorItem) => !isSyntheticCompetitor(item))
            .map((item: CompetitorItem) => ({
              ...item,
              type: item.type || 'DIRECT',
              userDecision: item.userDecision || (item.source === 'AI' ? 'PENDING' : 'ACCEPTED'),
            })),
        );
        if (result?.matrices) {
          onMatricesUpdated?.(result.matrices as CompetitiveMatrixPayload);
        }
        setSuccess(result?.message || 'Competitor edits saved.');
        router.refresh();
      }
    } catch (saveError) {
      console.error(saveError);
      setError('Unexpected error while saving edits.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runAiDiscovery}
          disabled={isDiscovering || discoveryMeta.remainingRuns <= 0}
          className="inline-flex items-center gap-2 rounded-xl bg-[#121212] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60"
        >
          {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-emerald-400" />}
          Discover Competitors with AI
        </button>

        <button
          type="button"
          onClick={saveEdits}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-[#121212] transition hover:bg-gray-50 disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Manual Edits
        </button>

        <span className="text-xs font-semibold text-gray-500">
          {visibleCompetitors.length} active / {acceptedCount} accepted
        </span>
        <span className="text-xs font-semibold text-indigo-600">
          Discovery runs: {discoveryMeta.usedRuns}/{discoveryMeta.maxRuns}
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{success}</div>
      ) : null}

      <div className="relative w-full h-[300px] sm:h-[360px] border-l-2 border-b-2 border-gray-200 bg-gray-50/50 rounded-tr-lg rounded-bl-lg overflow-visible">
        <span className="absolute -left-14 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
          Product Sophistication
        </span>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
          Audience Size
        </span>

        <div className="absolute left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="h-8 w-8 rounded-full bg-indigo-600 border-4 border-indigo-200 shadow-xl z-20 flex items-center justify-center">
            <Target className="w-4 h-4 text-white" />
          </div>
          <span className="mt-2 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded shadow-sm">
            Your Brand
          </span>
        </div>

        {positionedCompetitors.map((competitor) => {
          return (
            <div
              key={competitor.id}
              className="absolute flex flex-col items-center group transition-all duration-200 hover:z-40"
              style={{
                left: `${competitor.point.x}%`,
                top: `${competitor.point.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className={`h-4 w-4 rounded-full border-2 shadow-sm z-10 transition-transform group-hover:scale-150 ${getTypeStyles(competitor.type)}`} />
              <span className="mt-1.5 text-[10px] font-bold text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
                {competitor.name}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-semibold text-gray-500">
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500 border border-rose-200" /> Direct</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-400 border border-amber-200" /> Indirect</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-400 border border-emerald-200" /> Aspirational</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#121212]">
          Top Competitors by Brand Position
        </h4>
        {topCompetitors.length === 0 ? (
          <p className="text-sm text-gray-500">No accepted competitors yet.</p>
        ) : (
          <div className="space-y-2">
            {topCompetitors.map((competitor, index) => (
              <div
                key={competitor.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#121212] truncate">
                    {index + 1}. {competitor.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {competitor.domain || 'No domain'}{competitor.type ? ` · ${competitor.type}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-gray-500">
                  Audience {Math.round(competitor.point.x)} / Sophistication{' '}
                  {Math.round(100 - competitor.point.y)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#121212]">Add Competitor Manually</h4>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            value={manualName}
            onChange={(event) => setManualName(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[#121212] focus:border-indigo-500 focus:outline-none"
            placeholder="Competitor name"
          />
          <input
            type="text"
            value={manualDomain}
            onChange={(event) => setManualDomain(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[#121212] focus:border-indigo-500 focus:outline-none"
            placeholder="competitor.com"
          />
          <button
            type="button"
            onClick={addManualCompetitor}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#121212] border border-gray-300 hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {competitors.map((competitor) => (
          <div key={competitor.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={competitor.name}
                onChange={(event) => updateCompetitor(competitor.id, { name: event.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                placeholder="Name"
              />
              <input
                type="text"
                value={competitor.domain || ''}
                onChange={(event) => updateCompetitor(competitor.id, { domain: event.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                placeholder="Domain"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={competitor.type || 'DIRECT'}
                onChange={(event) => updateCompetitor(competitor.id, { type: event.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="DIRECT">Direct</option>
                <option value="INDIRECT">Indirect</option>
                <option value="ASPIRATIONAL">Aspirational</option>
              </select>

              <select
                value={competitor.userDecision || (competitor.source === 'AI' ? 'PENDING' : 'ACCEPTED')}
                onChange={(event) => updateCompetitor(competitor.id, { userDecision: event.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="PENDING">Pending Review</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            {competitor.description ? (
              <p className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
                {competitor.description}
              </p>
            ) : null}
            {(competitor.category || competitor.audienceGuess) && (
              <div className="flex flex-wrap gap-2">
                {competitor.category ? (
                  <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                    {competitor.category}
                  </span>
                ) : null}
                {competitor.audienceGuess ? (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
                    {competitor.audienceGuess}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#121212]">Discovery Archive</h4>
        {discoveryArchive.length === 0 ? (
          <p className="text-sm text-gray-500">No discovery runs yet.</p>
        ) : (
          <div className="space-y-2">
            {discoveryArchive.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="text-sm font-medium text-[#121212]">
                  Run #{run.runNumber} ({run.discoveredCount} competitors)
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(run.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

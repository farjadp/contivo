'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Loader2, Plus, Sparkles, Target } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';

import {
  addManualCompetitor,
  getDiscoveryStatus,
  setCompetitorDecision,
  startCompetitorDiscovery,
  updateCompetitorType,
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

/**
 * Terminal states of a `DiscoveryRun` — once the polled status lands on one
 * of these, `runAiDiscovery` stops polling. Kept in sync with the `status`
 * values `runDiscoveryPipeline` (`@/lib/competitors/pipeline`) writes.
 */
const TERMINAL_RUN_STATUSES = new Set(['DONE', 'EMPTY', 'FAILED']);
const POLL_INTERVAL_MS = 4000;
// Generous relative to STALE_RUN_MINUTES (10): this is a client-side safety
// net so a browser tab left open doesn't poll forever, not the source of
// truth for when a run is actually dead — `reapStaleRuns` owns that.
const MAX_POLL_ATTEMPTS = 150;

/** The five stage names `runDiscoveryPipeline` writes to `DiscoveryRun.stage`. */
const KNOWN_STAGES = new Set(['QUERIES', 'SEARCH', 'ENRICH', 'JUDGE', 'SAVE']);

/**
 * Translates a pipeline stage into a label for `discoveringStage`, instead
 * of interpolating the raw enum value — `tabsB.competitorMap.stages` was
 * missing, so the Persian UI was rendering the English enum verbatim, e.g.
 * «در حال یافتن رقبا… (ENRICH)». Falls back to the raw value for a stage
 * this UI doesn't recognise yet, rather than throwing on a missing message.
 */
function stageLabel(t: ReturnType<typeof useTranslations>, stage: string): string {
  if (KNOWN_STAGES.has(stage)) {
    return t(`stages.${stage as 'QUERIES' | 'SEARCH' | 'ENRICH' | 'JUDGE' | 'SAVE'}`);
  }
  return stage;
}

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
  // Rival blue for every competitor, told apart by fill (see the matrix tab).
  if (type === 'DIRECT') return 'bg-rival border-rival';
  if (type === 'INDIRECT') return 'bg-chalk-raised border-rival';
  return 'bg-moss-700 border-moss-700';
}

/**
 * Map a `getDiscoveryStatus`/`addManualCompetitor` `CompetitorView` (the
 * server's serialization) back onto this component's own looser
 * `CompetitorItem` shape, which is also what `initialCompetitors` arrives
 * as straight from a Prisma row via the parent page.
 */
function fromCompetitorView(view: {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  type: string;
  userDecision: string;
  source: string;
}): CompetitorItem {
  return {
    id: view.id,
    name: view.name,
    domain: view.domain,
    description: view.description,
    category: null,
    audienceGuess: null,
    type: view.type,
    userDecision: view.userDecision,
    source: view.source,
  };
}

export function CompetitorMapManager({
  workspaceId,
  initialCompetitors,
  initialMeta,
  initialArchive,
}: {
  workspaceId: string;
  initialCompetitors: CompetitorItem[];
  initialMeta?: DiscoveryMeta;
  initialArchive?: DiscoveryArchiveItem[];
}) {
  const t = useTranslations('tabsB.competitorMap');
  const format = useFormatter();
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
  // Decisions and type changes each save the instant they are made — there
  // is no bulk "save edits" step, and no local-only draft state to lose on
  // navigation. These two sets track which rows are mid-flight so their
  // controls can show a spinner and stay disabled during that one request.
  const [savingDecisionIds, setSavingDecisionIds] = useState<string[]>([]);
  const [savingTypeIds, setSavingTypeIds] = useState<string[]>([]);
  const [manualDomain, setManualDomain] = useState('');
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryStage, setDiscoveryStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [discoveryMeta, setDiscoveryMeta] = useState<DiscoveryMeta>(
    initialMeta || { usedRuns: 0, remainingRuns: 3, maxRuns: 3 },
  );
  const [discoveryArchive] = useState<DiscoveryArchiveItem[]>(initialArchive || []);

  // Guards a poll loop that outlives the component (tab navigated away
  // mid-discovery) from setting state on an unmounted component.
  const pollGuard = useRef(0);
  useEffect(() => () => {
    pollGuard.current += 1;
  }, []);

  const applyDecision = async (competitorId: string, decision: 'ACCEPTED' | 'REJECTED' | 'PENDING') => {
    const previous = competitors.find((c) => c.id === competitorId)?.userDecision;
    if (previous === decision) return;

    // Optimistic: the button reflects the choice immediately, and rolls back
    // if the write fails, so the screen never claims something the DB refused.
    updateCompetitorLocal(competitorId, { userDecision: decision });
    setError(null);

    setSavingDecisionIds((ids) => [...ids, competitorId]);
    try {
      const result = await setCompetitorDecision(workspaceId, competitorId, decision);
      if (result && 'error' in result && result.error) {
        updateCompetitorLocal(competitorId, { userDecision: previous });
        setError(result.error);
      }
    } catch (err) {
      console.error(err);
      updateCompetitorLocal(competitorId, { userDecision: previous });
      setError(t('decisionFailed'));
    } finally {
      setSavingDecisionIds((ids) => ids.filter((id) => id !== competitorId));
      router.refresh();
    }
  };

  const applyType = async (competitorId: string, type: string) => {
    const previous = competitors.find((c) => c.id === competitorId)?.type;
    if (previous === type) return;
    if (type !== 'DIRECT' && type !== 'INDIRECT' && type !== 'ASPIRATIONAL') return;

    updateCompetitorLocal(competitorId, { type });
    setError(null);

    setSavingTypeIds((ids) => [...ids, competitorId]);
    try {
      const result = await updateCompetitorType(workspaceId, competitorId, type);
      if (result && 'error' in result && result.error) {
        updateCompetitorLocal(competitorId, { type: previous });
        setError(result.error);
      }
    } catch (err) {
      console.error(err);
      updateCompetitorLocal(competitorId, { type: previous });
      setError(t('typeSaveFailed'));
    } finally {
      setSavingTypeIds((ids) => ids.filter((id) => id !== competitorId));
      router.refresh();
    }
  };

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

  const updateCompetitorLocal = (id: string, patch: Partial<CompetitorItem>) => {
    setCompetitors((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addCompetitor = async () => {
    const domain = manualDomain.trim();
    if (!domain) return;

    setIsAddingManual(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await addManualCompetitor(workspaceId, domain);
      if ('error' in result) {
        setError(result.error);
        return;
      }

      setCompetitors((prev) => [...prev, fromCompetitorView(result.competitor)]);
      setManualDomain('');
      setSuccess(result.judgeWarning || t('added'));
      router.refresh();
    } catch (addError) {
      console.error(addError);
      setError(t('addFailed'));
    } finally {
      setIsAddingManual(false);
    }
  };

  const runAiDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryStage(null);
    setError(null);
    setSuccess(null);

    const myRun = ++pollGuard.current;

    try {
      const started = await startCompetitorDiscovery(workspaceId);
      if ('error' in started) {
        if (started.meta) setDiscoveryMeta(started.meta);
        setError(started.error);
        return;
      }

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        // The component unmounted, or another discovery run started while
        // this loop was sleeping — either way this poll is stale.
        if (pollGuard.current !== myRun) return;

        const status = await getDiscoveryStatus(workspaceId);
        if (pollGuard.current !== myRun) return;

        setDiscoveryMeta(status.meta);
        if (status.run) setDiscoveryStage(status.run.stage);

        if (status.run && TERMINAL_RUN_STATUSES.has(status.run.status)) {
          setCompetitors(
            status.competitors
              .filter((item) => !isSyntheticCompetitor(item))
              .map(fromCompetitorView),
          );

          if (status.run.status === 'FAILED') {
            setError(status.run.error || t('discoverFailed'));
          } else if (status.run.status === 'EMPTY') {
            setSuccess(t('discoveredNone'));
          } else {
            setSuccess(t('discovered'));
          }
          router.refresh();
          return;
        }
      }

      // Polling gave up before the run reached a terminal state — the run
      // itself is still tracked server-side (and will eventually be reaped
      // if it is truly stuck), this is just the browser no longer watching.
      setError(t('discoverFailed'));
    } catch (discoverError) {
      console.error(discoverError);
      if (pollGuard.current === myRun) setError(t('discoverFailed'));
    } finally {
      if (pollGuard.current === myRun) {
        setIsDiscovering(false);
        setDiscoveryStage(null);
      }
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runAiDiscovery}
          disabled={isDiscovering || discoveryMeta.remainingRuns <= 0}
          className="inline-flex items-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-sm font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-60"
        >
          {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-saffron" />}
          {isDiscovering && discoveryStage ? t('discoveringStage', { stage: stageLabel(t, discoveryStage) }) : t('discover')}
        </button>

        <span className="text-xs font-semibold text-moss-muted">
          {t('counts', {
            active: format.number(visibleCompetitors.length),
            accepted: format.number(acceptedCount),
          })}
        </span>
        <span className="text-xs font-semibold text-moss-700">
          {t('runs', {
            used: format.number(discoveryMeta.usedRuns),
            max: format.number(discoveryMeta.maxRuns),
          })}
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{success}</div>
      ) : null}

      {/*
        Same decision as the admin console's charts and the positioning
        matrix above: the plot area is pinned to `ltr` so the axes keep
        their low-to-high reading and every point stays where its score
        puts it. The axis captions and the brand pin inside are translated;
        only the frame is physical.
      */}
      <div
        dir="ltr"
        className="relative w-full h-[300px] sm:h-[360px] border-l-2 border-b-2 border-rule bg-chalk/50 rounded-tr-lg rounded-bl-lg overflow-visible"
      >
        <span className="absolute -left-14 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold text-moss-muted uppercase tracking-widest whitespace-nowrap">
          {t('axisSophistication')}
        </span>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-moss-muted uppercase tracking-widest whitespace-nowrap">
          {t('axisAudience')}
        </span>

        <div className="absolute left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="h-8 w-8 rounded-full bg-saffron border-2 border-moss shadow-xl z-20 flex items-center justify-center">
            <Target className="w-4 h-4 text-moss" />
          </div>
          <span className="mt-2 text-xs font-bold text-moss bg-chalk-sunk border border-rule px-2 py-0.5 rounded shadow-sm">
            {t('yourBrand')}
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
              <span className="mt-1.5 text-[10px] font-bold text-moss bg-chalk-raised border border-rule px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
                {/* Competitor names are data, never translated. */}
                <bdi>{competitor.name}</bdi>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 pt-6 text-xs font-semibold text-moss-muted">
        <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full border-2 ${getTypeStyles('DIRECT')}`} /> {t('legend.direct')}</div>
        <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full border-2 ${getTypeStyles('INDIRECT')}`} /> {t('legend.indirect')}</div>
        <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full border-2 ${getTypeStyles('ASPIRATIONAL')}`} /> {t('legend.aspirational')}</div>
      </div>

      <div className="rounded-2xl border border-rule bg-chalk-raised p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-moss">
          {t('topTitle')}
        </h4>
        {topCompetitors.length === 0 ? (
          <p className="text-sm text-moss-muted">{t('topEmpty')}</p>
        ) : (
          <div className="space-y-2">
            {topCompetitors.map((competitor, index) => (
              <div
                key={competitor.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-rule bg-chalk px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-moss truncate">
                    {format.number(index + 1)}. <bdi>{competitor.name}</bdi>
                  </p>
                  <p className="text-xs text-moss-muted truncate">
                    <bdi>{competitor.domain || t('noDomain')}</bdi>
                    {competitor.type
                      ? ` · ${t(`types.${competitor.type as 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL'}`)}`
                      : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-moss-muted">
                  {t('scorePair', {
                    audience: format.number(Math.round(competitor.point.x)),
                    sophistication: format.number(Math.round(100 - competitor.point.y)),
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-rule bg-chalk p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-moss">{t('addTitle')}</h4>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={manualDomain}
            onChange={(event) => setManualDomain(event.target.value)}
            className="w-full rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-sm text-moss focus:border-moss focus:outline-none"
            placeholder={t('manualDomainPlaceholder')}
            dir="ltr"
          />
          <button
            type="button"
            onClick={addCompetitor}
            disabled={isAddingManual || !manualDomain.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-chalk-raised px-4 py-2 text-sm font-bold text-moss border border-rule-strong hover:bg-chalk-sunk disabled:opacity-60"
          >
            {isAddingManual ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('add')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {competitors.map((competitor) => (
          <div key={competitor.id} className="rounded-xl border border-rule bg-chalk-raised p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-moss truncate">
                <bdi>{competitor.name}</bdi>
              </p>
              <p className="text-xs text-moss-muted truncate" dir="ltr">
                {competitor.domain || t('noDomain')}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={competitor.type || 'DIRECT'}
                onChange={(event) => applyType(competitor.id, event.target.value)}
                disabled={savingTypeIds.includes(competitor.id)}
                className="w-full rounded-lg border border-rule-strong px-3 py-2 text-sm focus:border-moss focus:outline-none disabled:opacity-60"
              >
                <option value="DIRECT">{t('types.DIRECT')}</option>
                <option value="INDIRECT">{t('types.INDIRECT')}</option>
                <option value="ASPIRATIONAL">{t('types.ASPIRATIONAL')}</option>
              </select>

              <DecisionButtons
                value={competitor.userDecision || (competitor.source === 'AI' ? 'PENDING' : 'ACCEPTED')}
                saving={savingDecisionIds.includes(competitor.id)}
                onChange={(d) => applyDecision(competitor.id, d)}
              />
            </div>

            {competitor.description ? (
              <p className="rounded-md border border-rule bg-chalk px-3 py-2 text-xs leading-relaxed text-moss-muted">
                {competitor.description}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-rule bg-chalk-raised p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-moss">{t('archiveTitle')}</h4>
        {discoveryArchive.length === 0 ? (
          <p className="text-sm text-moss-muted">{t('archiveEmpty')}</p>
        ) : (
          <div className="space-y-2">
            {discoveryArchive.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-4 rounded-lg border border-rule bg-chalk px-3 py-2">
                <div className="text-sm font-medium text-moss">
                  {t('archiveRun', {
                    number: format.number(run.runNumber),
                    count: format.number(run.discoveredCount),
                  })}
                </div>
                <div className="text-xs text-moss-muted">
                  {format.dateTime(new Date(run.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionButtons({
  value,
  saving,
  onChange,
}: {
  value: string;
  saving: boolean;
  onChange: (decision: 'ACCEPTED' | 'REJECTED' | 'PENDING') => void;
}) {
  const t = useTranslations('tabsB.competitorMap');
  const options: Array<{ key: 'ACCEPTED' | 'REJECTED'; label: string; on: string }> = [
    { key: 'ACCEPTED', label: t('accept'), on: 'bg-moss text-chalk border-moss' },
    { key: 'REJECTED', label: t('reject'), on: 'bg-red-600 text-chalk border-red-600' },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={saving}
            // Clicking the active choice clears it back to undecided.
            onClick={() => onChange(active ? 'PENDING' : o.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${
              active ? o.on : 'border-rule-strong bg-chalk-raised text-moss-muted hover:bg-chalk'
            }`}
          >
            {active && <Check className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-moss-muted" />
      ) : value === 'PENDING' ? (
        <span className="text-xs text-moss-muted">{t('undecided')}</span>
      ) : (
        <span className="text-xs text-moss-700">{t('decisionSaved')}</span>
      )}
    </div>
  );
}

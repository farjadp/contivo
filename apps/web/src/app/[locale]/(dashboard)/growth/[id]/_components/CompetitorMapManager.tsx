'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';

import {
  addManualCompetitor,
  getDiscoveryStatus,
  listDiscoveryRuns,
  removeCompetitor,
  setCompetitorDecision,
  startCompetitorDiscovery,
  updateCompetitorType,
} from '@/app/actions/growth-competitors';
import type {
  CompetitorView,
  DiscoveryMeta,
  RunHistoryItem,
  RunView,
} from '@/app/actions/growth-competitors';
import type { CompetitorType } from '@/lib/competitors/types';
import { ErrorNote } from './CompetitorBits';
import { CompetitorDiscoveryPanel, type TargetMarketView } from './CompetitorDiscoveryPanel';
import { CompetitorList, ManualCompetitorForm, RunHistory, type LegacyRun } from './CompetitorList';
import { CompetitorReviewQueue, DecisionUndoBar, type LastDecision } from './CompetitorReviewQueue';
import {
  POLL_INTERVAL_MS,
  isRunActive,
  mergeCompetitors,
  shouldKeepPolling,
  sortByConfidence,
  type RejectionReasonChip,
} from './competitor-discovery-logic';

type DiscoveryStatus = Awaited<ReturnType<typeof getDiscoveryStatus>>;

/**
 * The competitors section of the Growth workspace: a run panel, a review
 * queue of PENDING suggestions with their evidence, and the accepted list.
 *
 * The name is kept from the scatter-map component this replaces so the tab
 * that renders it did not need restructuring. The map is gone on purpose: it
 * positioned competitors from regex guesses over their descriptions, which
 * presented invented numbers as a chart.
 *
 * Every change saves the moment it is made. There is no draft state and no
 * save button; accept and reject offer an undo instead.
 */
export function CompetitorMapManager({
  workspaceId,
  initialMeta,
  initialArchive,
  initialMarket,
}: {
  workspaceId: string;
  initialMeta: DiscoveryMeta;
  initialArchive?: LegacyRun[];
  initialMarket: TargetMarketView;
}) {
  const t = useTranslations('growth.competitors');
  const format = useFormatter();
  const router = useRouter();
  // Read through a ref inside the load and poll callbacks, so a router object
  // that changes identity between renders can never re-trigger the initial
  // load or restart the poll interval.
  const routerRef = useRef(router);
  routerRef.current = router;

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [run, setRun] = useState<RunView | null>(null);
  const [meta, setMeta] = useState<DiscoveryMeta>(initialMeta);
  const [competitors, setCompetitors] = useState<CompetitorView[]>([]);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [market, setMarket] = useState<TargetMarketView>(initialMarket);
  // The market the latest run searched, as far as this page knows: the
  // saved market when the page loaded, then whatever was saved when a run
  // was started here. Editing the market afterwards must not rewrite what
  // an EMPTY result says was searched. (RunView does not expose the run's
  // own market snapshot, so a market changed in another session before
  // this page loaded is not reflected.)
  const [runMarket, setRunMarket] = useState<TargetMarketView>(initialMarket);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);

  const [savingDecisionIds, setSavingDecisionIds] = useState<ReadonlySet<string>>(new Set());
  const [savingTypeIds, setSavingTypeIds] = useState<ReadonlySet<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<LastDecision | null>(null);

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [addWarning, setAddWarning] = useState<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Rows with a write in flight. A poll that lands mid-save keeps the local
  // copy of these rather than flipping them back to what the server had a
  // moment ago. A ref, not state: the poll callback reads it asynchronously.
  const inFlightRef = useRef<Set<string>>(new Set());
  const runRef = useRef<RunView | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const addTo = (setter: typeof setSavingDecisionIds, id: string) =>
    setter((prev) => new Set(prev).add(id));
  const removeFrom = (setter: typeof setSavingDecisionIds, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const refreshHistory = useCallback(async () => {
    try {
      const runs = await listDiscoveryRuns(workspaceId);
      if (mountedRef.current) setHistory(runs);
    } catch (error) {
      console.error(error);
    }
  }, [workspaceId]);

  const applyStatus = useCallback(
    (status: DiscoveryStatus) => {
      const wasActive = isRunActive(runRef.current?.status);
      runRef.current = status.run;
      setRun(status.run);
      setMeta(status.meta);
      setCompetitors((prev) => mergeCompetitors(status.competitors, prev, inFlightRef.current));
      if (wasActive && !isRunActive(status.run?.status)) {
        // A run just finished while this page was watching it.
        void refreshHistory();
        routerRef.current.refresh();
      }
    },
    [refreshHistory],
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [status, runs] = await Promise.all([getDiscoveryStatus(workspaceId), listDiscoveryRuns(workspaceId)]);
      if (!mountedRef.current) return;
      applyStatus(status);
      setHistory(runs);
      setLoadState('ready');
    } catch (error) {
      console.error(error);
      if (mountedRef.current) setLoadState('error');
    }
  }, [workspaceId, applyStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while the latest run is PENDING or RUNNING. When a poll comes
  // back DONE, EMPTY or FAILED, `runActive` flips and this effect's cleanup
  // clears the interval; unmounting clears it too.
  const runActive = isRunActive(run?.status);
  const runId = run?.id;
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
        const status = await getDiscoveryStatus(workspaceId);
        if (!cancelled) applyStatus(status);
      } catch (error) {
        // One failed poll is not the end of the run; the next tick retries.
        console.error(error);
      } finally {
        inFlight = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runActive, runId, workspaceId, applyStatus]);

  const startRun = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const started = await startCompetitorDiscovery(workspaceId);
      if ('error' in started) {
        if (started.meta) setMeta(started.meta);
        setStartError(started.error);
        // A dispatch failure leaves a FAILED run behind; show it.
        try {
          const status = await getDiscoveryStatus(workspaceId);
          if (mountedRef.current) applyStatus(status);
        } catch (error) {
          console.error(error);
        }
        return;
      }
      setRunMarket(market);
      const status = await getDiscoveryStatus(workspaceId);
      if (mountedRef.current) applyStatus(status);
      void refreshHistory();
    } catch (error) {
      console.error(error);
      if (mountedRef.current) setStartError(t('run.startFailed'));
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const patchLocal = (id: string, patch: Partial<CompetitorView>) =>
    setCompetitors((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  /** Saves a decision immediately, optimistically, rolling back on failure. Returns whether it saved. */
  const saveDecision = async (
    competitor: CompetitorView,
    decision: 'ACCEPTED' | 'REJECTED' | 'PENDING',
    reason?: RejectionReasonChip,
  ): Promise<boolean> => {
    const previous = { userDecision: competitor.userDecision, rejectionReason: competitor.rejectionReason };
    patchLocal(competitor.id, { userDecision: decision, rejectionReason: decision === 'REJECTED' ? reason ?? null : null });
    setActionError(null);
    inFlightRef.current.add(competitor.id);
    addTo(setSavingDecisionIds, competitor.id);
    try {
      const result = await setCompetitorDecision(workspaceId, competitor.id, decision, reason);
      if ('error' in result) {
        patchLocal(competitor.id, previous);
        setActionError(result.error);
        return false;
      }
      return true;
    } catch (error) {
      console.error(error);
      patchLocal(competitor.id, previous);
      setActionError(t('queue.decisionFailed'));
      return false;
    } finally {
      inFlightRef.current.delete(competitor.id);
      removeFrom(setSavingDecisionIds, competitor.id);
      router.refresh();
    }
  };

  const decide = async (competitor: CompetitorView, decision: 'ACCEPTED' | 'REJECTED') => {
    const saved = await saveDecision(competitor, decision);
    if (saved) setLastDecision({ id: competitor.id, name: competitor.name, decision, reason: null, busy: false });
  };

  const undo = async () => {
    if (!lastDecision) return;
    const competitor = competitors.find((item) => item.id === lastDecision.id);
    if (!competitor) {
      setLastDecision(null);
      return;
    }
    setLastDecision({ ...lastDecision, busy: true });
    const saved = await saveDecision(competitor, 'PENDING');
    if (saved) setLastDecision(null);
    else {
      setLastDecision({ ...lastDecision, busy: false });
      setActionError(t('undo.undoFailed'));
    }
  };

  const chooseReason = async (reason: RejectionReasonChip) => {
    if (!lastDecision || lastDecision.decision !== 'REJECTED') return;
    const competitor = competitors.find((item) => item.id === lastDecision.id);
    if (!competitor) return;
    setLastDecision({ ...lastDecision, busy: true });
    const saved = await saveDecision(competitor, 'REJECTED', reason);
    setLastDecision((current) =>
      current && current.id === lastDecision.id
        ? { ...current, busy: false, reason: saved ? reason : current.reason }
        : current,
    );
  };

  const changeType = async (competitor: CompetitorView, type: CompetitorType) => {
    if (competitor.type === type) return;
    const previous = competitor.type;
    patchLocal(competitor.id, { type });
    setActionError(null);
    inFlightRef.current.add(competitor.id);
    addTo(setSavingTypeIds, competitor.id);
    try {
      const result = await updateCompetitorType(workspaceId, competitor.id, type);
      if ('error' in result) {
        patchLocal(competitor.id, { type: previous });
        setActionError(result.error);
      }
    } catch (error) {
      console.error(error);
      patchLocal(competitor.id, { type: previous });
      setActionError(t('queue.typeSaveFailed'));
    } finally {
      inFlightRef.current.delete(competitor.id);
      removeFrom(setSavingTypeIds, competitor.id);
      router.refresh();
    }
  };

  const remove = async (competitor: CompetitorView) => {
    setActionError(null);
    addTo(setRemovingIds, competitor.id);
    try {
      const result = await removeCompetitor(workspaceId, competitor.id);
      if ('error' in result) {
        setActionError(result.error);
        return;
      }
      setCompetitors((prev) => prev.filter((item) => item.id !== competitor.id));
      if (lastDecision?.id === competitor.id) setLastDecision(null);
      router.refresh();
    } catch (error) {
      console.error(error);
      setActionError(t('list.removeFailed'));
    } finally {
      removeFrom(setRemovingIds, competitor.id);
    }
  };

  const addManual = async (domain: string): Promise<boolean> => {
    setAdding(true);
    setAddError(null);
    setAddedName(null);
    setAddWarning(null);
    try {
      const result = await addManualCompetitor(workspaceId, domain);
      if ('error' in result) {
        setAddError(result.error);
        return false;
      }
      setCompetitors((prev) => [...prev, result.competitor]);
      setAddedName(result.competitor.name);
      setAddWarning(result.judgeWarning);
      router.refresh();
      return true;
    } catch (error) {
      console.error(error);
      setAddError(t('add.failed'));
      return false;
    } finally {
      setAdding(false);
    }
  };

  const focusManualAdd = () => {
    const input = manualInputRef.current;
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  };

  const pending = useMemo(
    () => sortByConfidence(competitors.filter((item) => item.userDecision === 'PENDING')),
    [competitors],
  );
  const accepted = useMemo(() => competitors.filter((item) => item.userDecision === 'ACCEPTED'), [competitors]);
  const rejected = useMemo(() => competitors.filter((item) => item.userDecision === 'REJECTED'), [competitors]);

  if (loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-moss-muted" role="status">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-3">
        <ErrorNote>{t('loadFailed')}</ErrorNote>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-rule-strong bg-chalk-raised px-4 py-2 text-sm font-semibold text-moss transition hover:bg-chalk-sunk"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CompetitorDiscoveryPanel
        workspaceId={workspaceId}
        meta={meta}
        run={run}
        market={market}
        runMarket={runMarket}
        starting={starting}
        startError={startError}
        pollStopped={pollStopped}
        pendingCount={pending.length}
        onStart={startRun}
        onMarketSaved={setMarket}
        onAddManual={focusManualAdd}
      />

      {actionError ? <ErrorNote>{actionError}</ErrorNote> : null}

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-moss">
          {t('queue.title')}
          {pending.length > 0 ? (
            <span className="ms-2 rounded-full bg-saffron-soft px-2 py-0.5 text-xs font-bold text-saffron-ink">
              {format.number(pending.length)}
            </span>
          ) : null}
        </h3>
        {lastDecision ? (
          <DecisionUndoBar
            last={lastDecision}
            onUndo={() => void undo()}
            onReason={(reason) => void chooseReason(reason)}
            onDismiss={() => setLastDecision(null)}
          />
        ) : null}
        <CompetitorReviewQueue
          competitors={pending}
          savingDecisionIds={savingDecisionIds}
          savingTypeIds={savingTypeIds}
          onDecision={(competitor, decision) => void decide(competitor, decision)}
          onType={(competitor, type) => void changeType(competitor, type)}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-moss">{t('list.title')}</h3>
        <CompetitorList
          accepted={accepted}
          rejected={rejected}
          savingTypeIds={savingTypeIds}
          savingDecisionIds={savingDecisionIds}
          removingIds={removingIds}
          onType={(competitor, type) => void changeType(competitor, type)}
          onRemove={(competitor) => void remove(competitor)}
          onBackToReview={(competitor) => void saveDecision(competitor, 'PENDING')}
          addSlot={
            <ManualCompetitorForm
              ref={manualInputRef}
              adding={adding}
              error={addError}
              addedName={addedName}
              warning={addWarning}
              onAdd={addManual}
            />
          }
        />
        <RunHistory runs={history} legacy={initialArchive ?? []} />
      </section>
    </div>
  );
}

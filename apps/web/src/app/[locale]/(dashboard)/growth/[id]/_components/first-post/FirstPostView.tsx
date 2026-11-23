'use client';

/**
 * FirstPostView.tsx
 *
 * The workspace's `?tab=first-post` view (spec first-post B §4): one screen
 * per FirstPostState phase. It polls the run every 3 s while it is running,
 * and the publish job every 3 s for 3 minutes, then every 15 s, while the
 * post is on its way. Any phase change refreshes the server page (so the bar
 * and the rest of the page agree) and moves focus to the new heading.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { getFirstPostState } from '@/app/actions/first-post';
import { getPublishProgress } from '@/app/actions/publish-now';
import { useRouter } from '@/i18n/navigation';
import type { FirstPostDraft, FirstPostState, FirstPostViewProps, FirstPostWhyFacts, LinkedInState } from '@/lib/first-post/types';
import type { PublishOutcome } from '@/lib/publish-outcome';

import { CompetitorConfirm } from './CompetitorConfirm';
import { DraftCard } from './DraftCard';
import { PublishPanel } from './PublishPanel';
import { PublishedCard } from './PublishedCard';
import { RunProgress } from './RunProgress';
import { PUBLISH_FAST_POLL_MS, RUN_POLL_MS, isPublishSlow, publishPollDelay } from './first-post-view-logic';

type Live = {
  state: FirstPostState;
  draft: FirstPostDraft | null;
  why: FirstPostWhyFacts;
  otherAnglesUsed: number;
  linkedIn: LinkedInState;
};

export function FirstPostView(props: FirstPostViewProps) {
  const { workspaceId, competitors } = props;
  const t = useTranslations('tabsA.firstPost');
  const router = useRouter();
  const headingId = useId();

  // A poll result replaces the server props until the next server render.
  const [polled, setPolled] = useState<Live | null>(null);
  const [publishStarted, setPublishStarted] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setPolled(null);
    setPublishStarted(false);
  }, [props.state, props.draft]);

  const live: Live = polled ?? {
    state: props.state,
    draft: props.draft,
    why: props.why,
    otherAnglesUsed: props.otherAnglesUsed,
    linkedIn: props.linkedIn,
  };
  const { state, draft } = live;
  // "Publish now" was pressed here: show the wait before the server agrees.
  const phase = publishStarted && state.phase === 'draft' ? 'publishing' : state.phase;
  const contentItemId = 'contentItemId' in state ? state.contentItemId : (draft?.id ?? null);

  // The run: every 3 s while it is running.
  useEffect(() => {
    if (phase !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await getFirstPostState(workspaceId);
        if (cancelled) return;
        if (!('error' in res)) {
          setPolled({ ...res, linkedIn: res.facts.linkedIn });
          if (res.state.phase !== 'running') {
            router.refresh();
            return;
          }
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!cancelled) timer = setTimeout(tick, RUN_POLL_MS);
    };
    timer = setTimeout(tick, RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, workspaceId, router]);

  // Publishing: every 3 s for 3 min, then every 15 s, until it is live or failed.
  useEffect(() => {
    if (phase !== 'publishing' || !contentItemId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    setSlow(false);
    setOutcome(null);
    const tick = async () => {
      try {
        const res = await getPublishProgress(contentItemId);
        if (cancelled) return;
        if (!('error' in res)) {
          setOutcome(res.outcome);
          if (res.outcome?.kind === 'failed') return;
          if (res.outcome?.kind === 'published' || res.status === 'PUBLISHED') router.refresh();
        }
      } catch {
        // Retried on the next tick.
      }
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      setSlow(isPublishSlow(elapsed));
      timer = setTimeout(tick, publishPollDelay(elapsed));
    };
    timer = setTimeout(tick, PUBLISH_FAST_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, contentItemId, router]);

  // Focus follows the screen: a phase change moves it to the new heading.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    document.getElementById(headingId)?.focus();
  }, [phase, headingId]);

  const refresh = () => router.refresh();
  const startPublishing = () => {
    setPublishStarted(true);
    router.refresh();
  };

  let body: React.ReactNode;
  if (state.phase === 'confirm') {
    body = <CompetitorConfirm workspaceId={workspaceId} competitors={competitors} headingId={headingId} onStarted={refresh} />;
  } else if (state.phase === 'running' || state.phase === 'failed') {
    body = <RunProgress workspaceId={workspaceId} state={state} headingId={headingId} onRestarted={refresh} />;
  } else if (state.phase === 'published') {
    body = <PublishedCard workspaceId={workspaceId} state={state} headingId={headingId} />;
  } else if (!draft || !contentItemId) {
    body = (
      <h2 id={headingId} tabIndex={-1} className="text-[15px] text-moss-muted focus:outline-none">
        {t('draft.missing')}
      </h2>
    );
  } else {
    const publishing = phase === 'publishing';
    body = (
      <DraftCard
        key={draft.id}
        workspaceId={workspaceId}
        draft={draft}
        approved={state.phase === 'draft' ? state.approved : true}
        linkedIn={live.linkedIn}
        why={live.why}
        otherAnglesUsed={live.otherAnglesUsed}
        headingId={headingId}
        allowEdit={!publishing}
        onPublishStarted={startPublishing}
      >
        <PublishPanel
          workspaceId={workspaceId}
          contentItemId={contentItemId}
          linkedIn={live.linkedIn}
          mode={publishing ? 'publishing' : 'ready'}
          slow={slow}
          outcome={outcome}
          onStarted={startPublishing}
        />
      </DraftCard>
    );
  }

  return <section className="px-4 py-8 sm:px-8 lg:px-14 lg:py-10">{body}</section>;
}

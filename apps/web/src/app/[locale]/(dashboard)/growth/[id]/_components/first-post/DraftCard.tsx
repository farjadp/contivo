'use client';

/**
 * DraftCard.tsx
 *
 * The first post itself (spec first-post B §4.3): the text exactly as it will
 * be published, the quality verdict above it, Edit / Try another angle /
 * Write my own instead, and "Why this post" built from stored facts only.
 * The publish controls are passed in as `children`.
 */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { updateContentAndSchedule } from '@/app/actions/calendar';
import { firstPostOtherAngle, logFirstPostDraftEdit } from '@/app/actions/first-post';
import { recordNextStepClick } from '@/app/actions/next-step';
import { publishNow } from '@/app/actions/publish-now';
import { recheckContentQuality } from '@/app/actions/quality-gate';
import { Link, useRouter } from '@/i18n/navigation';
import {
  FIRST_POST_OTHER_ANGLE_LIMIT,
  type FirstPostDraft,
  type FirstPostWhyFacts,
  type LinkedInState,
} from '@/lib/first-post/types';

import { QualityVerdictNotice } from '../QualityVerdictNotice';
import { primaryButton, quietLink } from './PublishPanel';

export const eyebrow = 'font-plexmono text-[11px] uppercase tracking-[0.08em] text-moss-muted';
const tag = 'inline-flex items-center rounded px-2 py-0.5 font-plexmono text-[10.5px] uppercase tracking-[0.06em]';
export const sourceTag = `${tag} border border-moss-700 text-moss-700`;
export const aiTag = `${tag} bg-saffron-soft text-saffron-ink`;

/** "Write my own instead": records the step, then opens the write-your-own editor. */
export function WriteOwnButton({ workspaceId, label, className = quietLink }: { workspaceId: string; label: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await recordNextStepClick('writeOwn', 'workspace').catch(() => undefined);
    router.push({ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: 'pipeline', write: '1' } });
  };
  return (
    <button type="button" onClick={go} disabled={busy} className={className}>
      {label}
    </button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => Array.from(p)[0] ?? '').join('').toUpperCase();
}

function publishTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function WhyThisPost({ workspaceId, why }: { workspaceId: string; why: FirstPostWhyFacts }) {
  const t = useTranslations('tabsA.firstPost.why');
  const tabHref = (tab: string) => ({ pathname: '/growth/[id]' as const, params: { id: workspaceId }, query: { tab } });
  return (
    <aside aria-labelledby="first-post-why" className="text-[14px] text-moss">
      <h3 id="first-post-why" className={`${eyebrow} mb-3 font-medium`}>
        {t('title')}
      </h3>
      <ul>
        {why.topGap ? (
          <li className="border-t border-rule py-3.5">
            <span className={sourceTag}>{t('topGapTag')}</span>
            <p dir="auto" className="mt-1.5">
              {t('topGap', { topGap: why.topGap })}
            </p>
          </li>
        ) : null}
        {why.matricesReady && why.matrixCharts > 0 ? (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-rule py-3.5">
            <span>{t('matrices', { charts: why.matrixCharts })}</span>
            <Link href={tabHref('matrices')} className={quietLink}>
              {t('matricesView')}
            </Link>
          </li>
        ) : null}
        {why.keywordCompetitors > 0 ? (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-rule py-3.5">
            <span>{t('keywords', { competitors: why.keywordCompetitors })}</span>
            <Link href={tabHref('keywords')} className={quietLink}>
              {t('keywordsView')}
            </Link>
          </li>
        ) : null}
        <li className="border-y border-rule py-3.5">
          <span className={aiTag}>{t('aiTag')}</span>
          <p className="mt-1.5 text-moss-muted">{t('aiWording')}</p>
        </li>
      </ul>
    </aside>
  );
}

export function DraftCard({
  workspaceId,
  draft,
  approved,
  linkedIn,
  why,
  otherAnglesUsed,
  headingId,
  allowEdit = true,
  onPublishStarted,
  children,
}: {
  workspaceId: string;
  draft: FirstPostDraft;
  /** The run's gate result; the stored verdict on `draft` is what the notice reads. */
  approved: boolean;
  linkedIn: LinkedInState;
  why: FirstPostWhyFacts;
  otherAnglesUsed: number;
  headingId: string;
  /** False once the post is on its way: no edits, no other angle. */
  allowEdit?: boolean;
  /** "Publish anyway" scheduled the post at now. */
  onPublishStarted: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('tabsA.firstPost.draft');
  const router = useRouter();
  const [content, setContent] = useState(draft.content);
  const [verdict, setVerdict] = useState<unknown>(draft.qualityVerdict);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [angleBusy, setAngleBusy] = useState(false);

  const canTryAngle = allowEdit && otherAnglesUsed < FIRST_POST_OTHER_ANGLE_LIMIT;

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await updateContentAndSchedule({
        contentId: draft.id,
        content: editText,
        platform: 'linkedin',
        // Saving never schedules: no date, no time.
        publishDate: '',
        publishTime: '',
        timezone: publishTimezone(),
      });
      const saved = typeof updated?.content === 'string' ? updated.content : editText;
      // Funnel: lengths only, never the text. Not awaited; a lost row never blocks the save.
      logFirstPostDraftEdit(draft.id, content.length, saved.length).catch(() => undefined);
      setContent(saved);
      if (updated && 'qualityVerdict' in updated) setVerdict(updated.qualityVerdict);
      setEditing(false);
      setNotice({ tone: 'ok', text: t('saved') });
    } catch {
      setNotice({ tone: 'error', text: t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const otherAngle = async () => {
    setAngleBusy(true);
    setNotice(null);
    try {
      const result = await firstPostOtherAngle(workspaceId);
      if ('runId' in result) {
        router.refresh();
        return;
      }
      setNotice({ tone: 'error', text: result.error });
    } catch {
      setNotice({ tone: 'error', text: t('saveFailed') });
    }
    setAngleBusy(false);
  };

  const checkAgain = async () => {
    const res = await recheckContentQuality(draft.id);
    if ('error' in res) throw new Error(res.error);
    setVerdict(res.verdict);
    // The bar reads the stored verdict: a pass turns it to Connect / Publish.
    router.refresh();
  };

  // "Publish anyway": the override is stamped and audited on the server.
  const publishAnyway = async () => {
    const res = await publishNow(draft.id, { override: true });
    if ('ok' in res && res.ok) {
      onPublishStarted();
      return;
    }
    throw new Error('reason' in res ? res.reason : 'failed');
  };

  const angleButtonClass = approved ? quietLink : primaryButton;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
      <div className="min-w-0">
        <h2 id={headingId} tabIndex={-1} className={`${eyebrow} focus:outline-none`}>
          {t('eyebrow')}
        </h2>

        <div className="mt-3">
          <QualityVerdictNotice
            verdict={verdict}
            onCheckAgain={allowEdit ? checkAgain : undefined}
            checkAgainQuiet={!approved && canTryAngle}
            onPublishAnyway={allowEdit ? publishAnyway : undefined}
          />
        </div>

        <article className="rounded-xl border border-rule bg-chalk-raised px-5 py-5 sm:px-7 sm:py-6">
          <div className="mb-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-moss-700 text-[15px] font-semibold text-chalk"
            >
              {linkedIn.connected ? initials(linkedIn.accountName) : 'in'}
            </span>
            <div className="min-w-0">
              {linkedIn.connected ? (
                <p className="truncate text-[15px] font-semibold text-moss">
                  <bdi>{linkedIn.accountName}</bdi>
                </p>
              ) : null}
              <p className="text-[13px] text-moss-muted">{t('preview')}</p>
            </div>
          </div>

          {editing ? (
            <div className="space-y-3">
              <label htmlFor="first-post-editor" className="text-[13px] font-semibold text-moss">
                {t('editorLabel')}
              </label>
              <textarea
                id="first-post-editor"
                dir="auto"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={14}
                className="block w-full resize-y rounded-lg border border-rule-strong bg-chalk px-4 py-3 text-[15.5px] leading-relaxed text-moss focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/20"
              />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <button type="button" onClick={save} disabled={saving || !editText.trim()} className={primaryButton}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {saving ? t('saving') : t('save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditText(content);
                  }}
                  className={quietLink}
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div dir="auto" className="whitespace-pre-wrap break-words text-[15.5px] leading-relaxed text-moss">
              {content}
            </div>
          )}
        </article>

        {allowEdit && !editing ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => {
                setEditText(content);
                setEditing(true);
                setNotice(null);
              }}
              className={quietLink}
            >
              {t('edit')}
            </button>
            {canTryAngle ? (
              <button type="button" onClick={otherAngle} disabled={angleBusy} className={angleButtonClass}>
                {angleBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {angleBusy ? t('otherAngleBusy') : t('otherAngle')}
              </button>
            ) : null}
            <WriteOwnButton workspaceId={workspaceId} label={t('writeOwn')} />
          </div>
        ) : null}

        <p
          role={notice?.tone === 'error' ? 'alert' : 'status'}
          className={`mt-2 min-h-5 text-[13px] ${notice?.tone === 'error' ? 'text-red-700' : 'text-moss-muted'}`}
        >
          {notice?.text ?? ''}
        </p>

        {children ? <div className="mt-4">{children}</div> : null}
      </div>

      <WhyThisPost workspaceId={workspaceId} why={why} />
    </div>
  );
}


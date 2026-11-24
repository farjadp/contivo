'use client';

/*
  B8: what the quality gate said about an AI draft, in the reader's language.

  - `card`: on a Pipeline item. A blocked draft shows the badge, the reasons
    on request, "Check again" (one gate call, only when asked) and "Publish
    anyway…", which opens a confirm dialog listing the reasons. The server
    enforces the same rule; this only explains it.
  - `preview`: in the Ideation preview. Read-only, pass or fail.
*/

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

import {
  isBlockedVerdict,
  plainReasons,
  readStoredVerdict,
  type PlainReason,
} from '@/lib/quality-verdict-shared';

const SCORE_MAX = 10;

function ReasonList({ reasons }: { reasons: PlainReason[] }) {
  const t = useTranslations('tabsA.quality.reasons');
  return (
    <ul className="list-disc space-y-1 ps-5 text-xs leading-relaxed text-moss">
      {reasons.map((r) => (
        <li key={r.key}>{t(r.key, { score: r.score ?? 0, max: SCORE_MAX })}</li>
      ))}
    </ul>
  );
}

export function QualityVerdictNotice({
  verdict: rawVerdict,
  variant = 'card',
  onCheckAgain,
  onPublishAnyway,
  checkAgainQuiet = false,
}: {
  verdict: unknown;
  variant?: 'card' | 'preview';
  onCheckAgain?: () => Promise<void>;
  /** The page has a stronger next action (first post: "Try another angle"): Check again is a quiet link. */
  checkAgainQuiet?: boolean;
  onPublishAnyway?: () => Promise<void>;
}) {
  const t = useTranslations('tabsA.quality');
  const titleId = useId();
  const [showReasons, setShowReasons] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verdict = readStoredVerdict(rawVerdict);
  // Ungated (legacy, "Write a post"): nothing to say.
  if (rawVerdict === null || rawVerdict === undefined) return null;

  const blocked = isBlockedVerdict(rawVerdict);
  const reasons = plainReasons(verdict);
  const notes = verdict?.rejectedBy === 'judge_veto' || verdict?.rejectedBy === 'low_score' ? verdict.reasons : [];

  if (variant === 'preview') {
    if (verdict?.approved) {
      return (
        <p className="mb-4 inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {t('previewPassed')}
        </p>
      );
    }
    return (
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="flex items-start gap-2 text-xs font-semibold text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t('previewFailed')}
        </p>
        {reasons.length > 0 ? (
          <div className="mt-2">
            <ReasonList reasons={reasons} />
          </div>
        ) : null}
      </div>
    );
  }

  if (!blocked) {
    if (verdict?.override) {
      return <p className="mb-3 text-[11px] font-semibold text-amber-700">{t('overriddenNote')}</p>;
    }
    return null;
  }

  const notChecked = verdict?.rejectedBy === 'not_checked';

  const handleCheckAgain = async () => {
    if (!onCheckAgain) return;
    setError(null);
    setIsChecking(true);
    try {
      await onCheckAgain();
    } catch {
      setError(t('error'));
    } finally {
      setIsChecking(false);
    }
  };

  const handleConfirm = async () => {
    if (!onPublishAnyway) return;
    setError(null);
    setIsSaving(true);
    try {
      await onPublishAnyway();
      setIsConfirmOpen(false);
    } catch {
      setError(t('error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            {notChecked ? t('badge.notChecked') : t('badge.failed')}
          </span>
          <button
            type="button"
            onClick={() => setShowReasons((v) => !v)}
            aria-expanded={showReasons}
            className="text-[11px] font-bold text-amber-900 underline-offset-2 hover:underline"
          >
            {showReasons ? t('hideReasons') : t('showReasons')}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-amber-900">{t('heldNote')}</p>
        {showReasons ? (
          <div className="mt-2 space-y-2">
            <ReasonList reasons={reasons} />
            {notes.length > 0 ? (
              <div>
                <p className="text-[11px] font-bold text-moss-muted">{t('reviewerNotes')}</p>
                <ul className="list-disc ps-5 text-[11px] text-moss-muted" dir="auto">
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-2 text-[11px] font-medium text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onCheckAgain ? (
            <button
              type="button"
              onClick={handleCheckAgain}
              disabled={isChecking}
              className={
                checkAgainQuiet
                  ? 'inline-flex h-8 items-center gap-1.5 px-1 text-xs font-bold text-amber-900 underline underline-offset-2 disabled:opacity-50'
                  : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300 bg-chalk-raised px-3 text-xs font-bold text-moss transition hover:bg-chalk-sunk disabled:opacity-50'
              }
            >
              {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isChecking ? t('checking') : t('checkAgain')}
            </button>
          ) : null}
          {onPublishAnyway ? (
            <button
              type="button"
              onClick={() => setIsConfirmOpen(true)}
              className="h-8 rounded-lg px-3 text-xs font-bold text-amber-900 transition hover:bg-amber-100"
            >
              {t('publishAnyway')}
            </button>
          ) : null}
        </div>
      </div>

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-moss/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-2xl border border-rule bg-chalk-raised p-6 shadow-2xl"
          >
            <h2 id={titleId} className="text-base font-bold text-moss">
              {t('dialog.title')}
            </h2>
            <p className="mt-3 text-sm text-moss">{t('dialog.body')}</p>
            <div className="mt-2">
              <ReasonList reasons={reasons} />
            </div>
            <p className="mt-4 text-xs text-moss-muted">{t('dialog.note')}</p>
            {error ? <p className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isSaving}
                className="h-9 rounded-lg border border-rule px-4 text-sm font-bold text-moss transition hover:bg-chalk-sunk"
              >
                {t('dialog.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-moss px-4 text-sm font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSaving ? t('dialog.saving') : t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { submitBugReport } from '@/app/actions/bug-report';
import { MESSAGE_MAX, type ClientContext } from '@/lib/bug-report/types';
import { cn } from '@/lib/utils';
import { RefChip } from './RefChip';
import { sendReport } from './report-flow';

export type SheetPhase = 'form' | 'sending' | 'sent' | 'error';

type BodyProps = {
  phase: SheetPhase;
  message: string;
  attachedRef: string | null;
  sentRef: string | null;
  error: string | null;
  titleId: string;
  fieldId: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onClose: () => void;
};

/** The sheet's contents, with no state of its own: rendered directly by tests. */
export function ReportSheetBody(p: BodyProps) {
  const t = useTranslations('bugReport.sheet');
  const sending = p.phase === 'sending';

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id={p.titleId} className="font-display text-[20px] font-bold leading-tight tracking-tight text-moss">
          {p.phase === 'sent' ? t('sentTitle') : t('title')}
        </h2>
        <button
          type="button"
          onClick={p.onClose}
          aria-label={t('close')}
          className="-me-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-moss-muted hover:bg-chalk-sunk hover:text-moss"
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </div>

      {p.phase === 'sent' && p.sentRef ? (
        <>
          <p className="text-[14px] leading-relaxed text-moss-muted">{t('sentBody')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-medium text-moss-muted">{t('refLabel')}</span>
            <RefChip value={p.sentRef} copyLabel={t('copy')} copiedLabel={t('copied')} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={p.onClose}
              className="min-h-11 rounded-lg bg-moss px-5 text-[14px] font-semibold text-chalk transition-colors hover:bg-moss-700"
            >
              {t('close')}
            </button>
          </div>
        </>
      ) : (
        <>
          {p.attachedRef && (
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-moss-muted">
              <span>{t('withRef')}</span>
              <bdi dir="ltr" className="font-plexmono font-semibold tabular-nums text-moss">
                {p.attachedRef}
              </bdi>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={p.fieldId} className="text-[14px] font-medium text-moss">
              {t('label')}
            </label>
            <textarea
              id={p.fieldId}
              value={p.message}
              onChange={(e) => p.onMessageChange(e.target.value)}
              maxLength={MESSAGE_MAX}
              rows={5}
              disabled={sending}
              placeholder={t('placeholder')}
              className="min-h-32 w-full resize-y rounded-lg border border-rule-strong bg-chalk-raised p-3 text-[15px] leading-relaxed text-moss placeholder:text-moss-muted/70 focus-visible:border-moss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron"
            />
            <p className="text-end text-[12px] tabular-nums text-moss-muted">
              {t('counter', { count: p.message.length, max: MESSAGE_MAX })}
            </p>
          </div>

          <p className="text-[13px] leading-relaxed text-moss-muted">{t('note')}</p>

          {p.phase === 'error' && p.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-800">
              {p.error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            {p.phase === 'error' ? (
              <button
                type="button"
                onClick={p.onRetry}
                className="min-h-11 rounded-lg bg-moss px-5 text-[14px] font-semibold text-chalk transition-colors hover:bg-moss-700"
              >
                {t('retry')}
              </button>
            ) : (
              <button
                type="button"
                onClick={p.onSend}
                disabled={sending}
                className={cn(
                  'min-h-11 rounded-lg bg-moss px-5 text-[14px] font-semibold text-chalk transition-colors hover:bg-moss-700',
                  sending && 'opacity-70',
                )}
              >
                {sending ? t('sending') : t('send')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Native `<dialog>` opened with showModal(): the browser supplies the focus
 * trap, Esc to close and an inert page behind it. It only mounts while open,
 * so every opening starts from an empty form.
 */
export function ReportSheet({
  prefillRef,
  fallbackRef,
  getContext,
  onClose,
}: {
  prefillRef: string | null;
  fallbackRef: string | null;
  getContext: () => ClientContext;
  onClose: () => void;
}) {
  const t = useTranslations('bugReport.sheet');
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<SheetPhase>('form');
  const [message, setMessage] = useState('');
  const [sentRef, setSentRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachedRef = prefillRef ?? fallbackRef;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
  }, []);

  async function send() {
    setPhase('sending');
    setError(null);
    const outcome = await sendReport(submitBugReport, {
      message,
      ref: attachedRef,
      client: getContext(),
      fallbackError: t('errorFallback'),
    });
    if (outcome.phase === 'sent') {
      setSentRef(outcome.ref);
      setPhase('sent');
    } else {
      setError(outcome.error);
      setPhase('error');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl border border-rule bg-chalk p-0 text-moss shadow-2xl backdrop:bg-moss/40 motion-safe:animate-rise md:m-auto md:max-w-md md:rounded-2xl"
    >
      <ReportSheetBody
        phase={phase}
        message={message}
        attachedRef={attachedRef}
        sentRef={sentRef}
        error={error}
        titleId={titleId}
        fieldId={fieldId}
        onMessageChange={setMessage}
        onSend={send}
        onRetry={send}
        onClose={() => dialogRef.current?.close()}
      />
    </dialog>
  );
}

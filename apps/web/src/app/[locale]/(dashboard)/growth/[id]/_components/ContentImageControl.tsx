'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, ImageOff, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';

import { generateContentImage, removeContentImage } from '@/app/actions/content-image';
import {
  channelCarriesImage,
  imageEditableForStatus,
  IMAGE_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_MAX_BYTES,
  precheckImageUpload,
} from '@/lib/content-image-rules';
import { IMAGE_GENERATION_COST } from '@/lib/credit-costs';
import type { ContentImageMeta, ImageActionResult } from '@/lib/content-image-service';

import { imageNotice, type ImageNotice } from './content-image-notice';

type Busy = 'generate' | 'upload' | 'remove' | null;

/**
 * A post's picture: what is attached, and add / replace / remove before it
 * is scheduled. A failed generation says so in words with a reference, and
 * the post keeps its text: it publishes as text only, never silently.
 */
export function ContentImageControl({
  workspaceId,
  itemId,
  channel,
  status,
  topic,
  initialImage,
  autoGenerate = false,
  onChange,
}: {
  workspaceId: string;
  itemId: string;
  channel: string;
  status: string;
  topic: string;
  initialImage: ContentImageMeta | null;
  /** Generate once on mount (Ideation "Add an image", Write a post's image option). */
  autoGenerate?: boolean;
  onChange?: (image: ContentImageMeta | null) => void;
}) {
  const t = useTranslations('tabsA.image');
  const [image, setImage] = useState<ContentImageMeta | null>(initialImage);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<ImageNotice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const autoStarted = useRef(false);

  const carries = channelCarriesImage(channel);
  const editable = imageEditableForStatus(status);

  const apply = (result: ImageActionResult) => {
    if (result.ok) {
      setImage(result.image);
      setNotice(null);
      onChange?.(result.image);
      return;
    }
    setNotice(imageNotice(result));
  };

  const handleGenerate = async () => {
    if (busy) return;
    setBusy('generate');
    setNotice(null);
    try {
      apply(await generateContentImage(workspaceId, itemId));
    } catch {
      setNotice({ kind: 'failed', ref: null });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!autoGenerate || autoStarted.current || image || !carries || !editable) return;
    autoStarted.current = true;
    void handleGenerate();
    // Once per mount: the ref guards re-renders and Strict Mode's double effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    const pre = precheckImageUpload(file);
    if (pre) {
      setNotice({ kind: 'upload', error: pre });
      return;
    }
    setBusy('upload');
    setNotice(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `/api/content/${encodeURIComponent(itemId)}/image?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'POST', body },
      );
      const result = (await res.json().catch(() => null)) as ImageActionResult | null;
      apply(result ?? { ok: false, error: 'wrong_type' });
    } catch {
      setNotice({ kind: 'upload', error: 'network' });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy('remove');
    setNotice(null);
    try {
      apply(await removeContentImage(workspaceId, itemId));
    } catch {
      setNotice({ kind: 'upload', error: 'network' });
    } finally {
      setBusy(null);
    }
  };

  if (!carries) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-moss-muted">
        <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('textOnlyChannel')}
      </p>
    );
  }

  const noticeText = notice ? renderNotice(t, notice) : null;

  return (
    <div className="rounded-xl border border-rule bg-chalk px-3 py-2.5" data-testid="content-image-control">
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule bg-chalk-sunk">
          {busy === 'generate' || busy === 'upload' ? (
            <Loader2 className="h-5 w-5 animate-spin text-moss-muted" aria-hidden />
          ) : image ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, per-account bytes; next/image would cache them on the server
            <img
              src={`/api/content/${encodeURIComponent(itemId)}/image?v=${encodeURIComponent(image.id)}`}
              alt={image.altText || topic}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-moss-muted" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-moss" aria-live="polite">
            {busy === 'generate'
              ? t('generating')
              : busy === 'upload'
                ? t('uploading')
                : busy === 'remove'
                  ? t('removing')
                  : image
                    ? image.source === 'upload'
                      ? t('attachedUpload')
                      : t('attachedGenerated')
                    : t('none')}
          </p>
          {!editable ? <p className="mt-0.5 text-[11px] text-moss-muted">{t('locked')}</p> : null}
          {editable ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1 rounded-lg border border-rule-strong bg-chalk-raised px-2 py-1 text-[11px] font-bold text-moss transition-colors hover:border-moss disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                {image ? t('regenerate', { cost: IMAGE_GENERATION_COST }) : t('generate', { cost: IMAGE_GENERATION_COST })}
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1 rounded-lg border border-rule-strong bg-chalk-raised px-2 py-1 text-[11px] font-bold text-moss transition-colors hover:border-moss disabled:opacity-50"
              >
                <Upload className="h-3 w-3" aria-hidden />
                {image ? t('replaceUpload') : t('upload')}
              </button>
              {image ? (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={Boolean(busy)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-moss-muted transition-colors hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  {t('remove')}
                </button>
              ) : null}
              <input
                ref={fileInput}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                onChange={handleFile}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
              />
            </div>
          ) : null}
          {editable && !noticeText ? (
            <p className="mt-1.5 text-[10px] text-moss-muted">{t('uploadHint', { mb: IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024) })}</p>
          ) : null}
        </div>
      </div>
      {noticeText ? (
        <p
          role="status"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium leading-relaxed text-amber-900"
        >
          {noticeText}
        </p>
      ) : null}
    </div>
  );
}

function renderNotice(t: ReturnType<typeof useTranslations>, notice: ImageNotice): string {
  switch (notice.kind) {
    case 'failed':
      return notice.ref ? t('failed', { ref: notice.ref }) : t('failedNoRef');
    case 'credits':
      return t('insufficient', { required: notice.required, balance: notice.balance });
    case 'locked':
      return t('locked');
    case 'not_found':
      return t('notFound');
    case 'upload':
      return t(`uploadErrors.${notice.error}`, { mb: IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024) });
  }
}

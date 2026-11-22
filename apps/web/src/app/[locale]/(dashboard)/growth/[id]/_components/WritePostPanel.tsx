'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FilePenLine, Loader2, Save, X } from 'lucide-react';
import type { ContentItem } from '@prisma/client';

import { createOwnPost } from '@/app/actions/own-post';
import {
  normalizeSlugInput,
  POST_BODY_MAX,
  POST_TITLE_MAX,
  validatePostSlug,
  type OwnPostError,
} from '@/lib/content-slug';

type Channel = 'blog' | 'linkedin' | 'telegram';
type Field = 'title' | 'slug' | 'body' | 'form';

/** Which input an error belongs next to. */
export function ownPostErrorField(code: OwnPostError | string): Field {
  if (code === 'title_required' || code === 'title_too_long') return 'title';
  if (code === 'body_required' || code === 'body_too_long') return 'body';
  if (code === 'slug_invalid' || code === 'slug_taken' || code === 'slug_frozen') return 'slug';
  return 'form';
}

/** Translated message for an own-post error code; unknown codes get the generic line. */
export function ownPostErrorMessage(t: ReturnType<typeof useTranslations>, code: OwnPostError | string): string {
  const key = `pipeline.errors.own.${code}`;
  if (!t.has(key)) return t('pipeline.errors.own.unknown');
  return t(key, { max: code === 'title_too_long' ? POST_TITLE_MAX : POST_BODY_MAX });
}

/** A title the slugifier cannot transliterate falls back to post-xxxx. */
function hasNonLatinLetters(value: string): boolean {
  return /[^\u0000-\u024F]/.test(value);
}

export function WritePostPanel({
  workspaceId,
  onCreated,
  onClose,
}: {
  workspaceId: string;
  onCreated: (item: ContentItem) => void;
  onClose: () => void;
}) {
  const t = useTranslations('tabsA');
  const [channel, setChannel] = useState<Channel>('blog');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  const trimmedSlug = normalizeSlugInput(slug);
  const liveSlugError = channel === 'blog' && trimmedSlug ? validatePostSlug(trimmedSlug) : null;
  const showNonLatinHint = channel === 'blog' && !trimmedSlug && hasNonLatinLetters(title);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (liveSlugError) {
      setError({ field: 'slug', message: ownPostErrorMessage(t, liveSlugError) });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createOwnPost({
        workspaceId,
        title,
        content,
        channel,
        slug: channel === 'blog' && trimmedSlug ? trimmedSlug : undefined,
      });
      if (result.ok) {
        onCreated(result.item);
        onClose();
        return;
      }
      setError({ field: ownPostErrorField(result.error), message: ownPostErrorMessage(t, result.error) });
    } catch {
      setError({ field: 'form', message: t('pipeline.errors.own.unknown') });
    } finally {
      setPending(false);
    }
  };

  const fieldError = (field: Field) =>
    error?.field === field ? (
      <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
        {error.message}
      </p>
    ) : null;

  const inputClass =
    'w-full rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-sm text-moss outline-none transition focus:border-moss focus:ring-2 focus:ring-saffron';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-rule bg-chalk-raised p-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chalk-sunk text-moss-muted">
            <FilePenLine className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-bold text-moss">{t('pipeline.write.title')}</h3>
            <p className="mt-0.5 text-sm text-moss-muted">{t('pipeline.write.intro')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label={t('pipeline.write.close')}
          className="shrink-0 rounded-full p-2 text-moss-muted transition-colors hover:bg-chalk-sunk hover:text-moss disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-[11px] font-bold uppercase tracking-widest text-moss-muted">
            {t('pipeline.write.channelLabel')}
          </legend>
          <div className="inline-flex rounded-xl border border-rule bg-chalk p-1">
            {(['blog', 'linkedin', 'telegram'] as const).map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg px-4 py-1.5 text-sm font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-saffron ${
                  channel === value ? 'bg-moss text-chalk' : 'text-moss-muted hover:text-moss'
                }`}
              >
                <input
                  type="radio"
                  name="own-post-channel"
                  value={value}
                  checked={channel === value}
                  onChange={() => {
                    setChannel(value);
                    if (error?.field === 'slug') setError(null);
                  }}
                  className="sr-only"
                />
                <bdi>{t(`channels.${value}`)}</bdi>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="own-post-title" className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-moss-muted">
            {t('pipeline.write.titleLabel')}
          </label>
          <input
            id="own-post-title"
            type="text"
            dir="auto"
            value={title}
            maxLength={POST_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('pipeline.write.titlePlaceholder')}
            aria-invalid={error?.field === 'title'}
            className={`${inputClass} text-start font-semibold`}
          />
          {fieldError('title')}
        </div>

        {channel === 'blog' ? (
          <div>
            <label htmlFor="own-post-slug" className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-moss-muted">
              {t('pipeline.write.slugLabel')}
            </label>
            <input
              id="own-post-slug"
              type="text"
              dir="ltr"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="my-first-post"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(liveSlugError) || error?.field === 'slug'}
              aria-describedby="own-post-slug-hint"
              className={`${inputClass} font-plexmono ${liveSlugError ? 'border-red-400' : ''}`}
            />
            {error?.field === 'slug' ? (
              fieldError('slug')
            ) : liveSlugError ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">{ownPostErrorMessage(t, liveSlugError)}</p>
            ) : null}
            <p id="own-post-slug-hint" className="mt-1.5 text-[11px] leading-relaxed text-moss-muted">
              {showNonLatinHint ? t('pipeline.write.slugHintNonLatin') : t('pipeline.write.slugHint')}
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor="own-post-body" className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-moss-muted">
            {t('pipeline.write.bodyLabel')}
          </label>
          <textarea
            id="own-post-body"
            dir="auto"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('pipeline.write.bodyPlaceholder')}
            aria-invalid={error?.field === 'body'}
            className={`${inputClass} min-h-[280px] resize-y text-start leading-relaxed`}
          />
          {fieldError('body')}
        </div>
      </div>

      {fieldError('form')}

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-rule pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="px-4 py-2 text-sm font-bold text-moss-muted transition-colors hover:text-moss disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-moss px-5 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {pending ? t('pipeline.write.saving') : t('pipeline.write.save')}
        </button>
      </div>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { type ContentChannel, type ContentTone, type ContentItem } from '@contivo/types';

import { generateInstantContentAction } from '@/app/actions/instant';
import { cn } from '@/lib/utils';
import { InstantResult } from './instant-result';

// ─── Constants ────────────────────────────────────────────────────────────────

/*
  Network names are brands, not words: LinkedIn, Instagram and X read the same
  in both languages, so only the format underneath them is translated. Email
  and Blog are ordinary nouns and do get a Persian name, which is why they
  carry a `nameKey` and the networks do not.
*/
const CHANNELS: { value: ContentChannel; label?: string; nameKey?: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'X / Twitter' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'email', nameKey: 'email' },
  { value: 'blog', nameKey: 'blog' },
];

const TONES: ContentTone[] = ['professional', 'friendly', 'bold', 'educational', 'persuasive'];


// ─── Component ────────────────────────────────────────────────────────────────

export function InstantForm() {
  const t = useTranslations('instant');
  const [topic, setTopic] = useState('');
  const [channel, setChannel] = useState<ContentChannel>('linkedin');
  const [tone, setTone] = useState<ContentTone>('professional');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [result, setResult] = useState<{
    item: ContentItem;
    creditsRemaining: number;
  } | null>(null);



  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setFieldErrors(null);
    setResult(null);

    try {
      const response = await generateInstantContentAction({ topic, channel, tone });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setResult({
        item: response.item as unknown as ContentItem,
        creditsRemaining: response.creditsRemaining,
      });

      // The balance widget holds its own state, so tell it to re-read.
      window.dispatchEvent(new Event('credits-updated'));
    } catch (err) {
      console.error('Instant generation failed:', err);
      setError(t('form.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Channel picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('form.channel')}</label>
          <div className="grid grid-cols-5 gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setChannel(c.value)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl border py-3 px-2 text-xs font-medium transition-all',
                  channel === c.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                )}
              >
                <span className="font-semibold">
                  {c.label ? <bdi>{c.label}</bdi> : t(`channelNames.${c.nameKey}`)}
                </span>
                <span className="text-[10px] opacity-70">{t(`channels.${c.value}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Topic */}
        <div className="space-y-2">
          <label htmlFor="topic" className="text-sm font-medium">
            {t('form.topic')}
          </label>
          <textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('form.topicPlaceholder')}
            rows={3}
            required
            className={cn(
              'w-full rounded-xl border bg-muted/30 px-4 py-3 text-sm placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring resize-none transition-colors',
              fieldErrors?.topic ? 'border-destructive' : 'border-border',
            )}
          />
          {fieldErrors?.topic && (
            <p className="text-xs text-destructive">{fieldErrors.topic[0]}</p>
          )}
        </div>

        {/* Tone */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('form.tone')}</label>
          <div className="flex flex-wrap gap-2">
            {TONES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTone(value)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all',
                  tone === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tones.${value}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading || topic.trim().length < 3}
          className={cn(
            'w-full rounded-xl py-3.5 text-sm font-bold transition-all duration-300',
            'bg-moss text-chalk hover:bg-moss-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'flex items-center justify-center gap-2',
          )}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('form.generating')}
            </>
          ) : (
            t('form.generate')
          )}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && <InstantResult item={result.item} creditsRemaining={result.creditsRemaining} onReset={handleReset} />}
    </div>
  );
}

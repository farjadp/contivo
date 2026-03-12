'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type ContentChannel, type ContentTone, type ContentItem } from '@contivo/types';

import { generateInstantContent, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { InstantResult } from './instant-result';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNELS: { value: ContentChannel; label: string; description: string }[] = [
  { value: 'linkedin', label: 'LinkedIn', description: 'Post' },
  { value: 'twitter', label: 'X / Twitter', description: 'Thread' },
  { value: 'instagram', label: 'Instagram', description: 'Caption' },
  { value: 'email', label: 'Email', description: 'Draft' },
  { value: 'blog', label: 'Blog', description: 'Outline' },
];

const TONES: { value: ContentTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'bold', label: 'Bold' },
  { value: 'educational', label: 'Educational' },
  { value: 'persuasive', label: 'Persuasive' },
];


// ─── Component ────────────────────────────────────────────────────────────────

export function InstantForm() {
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
      // Token is fetched by ClerkTokenFetcher wrapper when Clerk is active.
      // In local dev (no Clerk), we pass no token — backend falls back to seeded dev user.
      const token = undefined;

      const response = await generateInstantContent({ topic, channel, tone }, token);
      setResult({
        item: response.contentItem,
        creditsRemaining: response.creditsRemaining
      });

      // Force refresh of the page/components to update the credit balance 
      // since the balance component is unlinked from the form state right now.
      window.dispatchEvent(new Event('credits-updated'));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INSUFFICIENT_CREDITS') {
          setError(err.message || 'You do not have enough credits to generate content.');
        } else if (err.errors) {
          setFieldErrors(err.errors);
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
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
          <label className="text-sm font-medium">Channel</label>
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
                <span className="font-semibold">{c.label}</span>
                <span className="text-[10px] opacity-70">{c.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Topic */}
        <div className="space-y-2">
          <label htmlFor="topic" className="text-sm font-medium">
            Topic
          </label>
          <textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Why B2B founders should invest in thought leadership before hiring a marketing team"
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
          <label className="text-sm font-medium">Tone</label>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTone(t.value)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all',
                  tone === t.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
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
            'bg-brand-gradient text-white hover:opacity-90 shadow-md shadow-brand-indigo/20',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'flex items-center justify-center gap-2',
          )}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            'Generate content'
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

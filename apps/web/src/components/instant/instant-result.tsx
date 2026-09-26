'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Copy, RefreshCw, Linkedin, Twitter, Mail, BookOpen, Camera } from 'lucide-react';
import type { ContentItem } from '@contivo/types';

import { cn } from '@/lib/utils';

// ─── Channel → icon + label ───────────────────────────────────────────────────

const CHANNEL_META: Record<string, { Icon: React.ElementType; color: string }> = {
  linkedin: { Icon: Linkedin, color: 'text-moss-700' },
  twitter: { Icon: Twitter, color: 'text-moss-700' },
  instagram: { Icon: Camera, color: 'text-moss-700' },
  email: { Icon: Mail, color: 'text-moss-700' },
  blog: { Icon: BookOpen, color: 'text-moss-700' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface InstantResultProps {
  item: ContentItem;
  creditsRemaining?: number;
  onReset: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export function InstantResult({ item, creditsRemaining, onReset }: InstantResultProps) {
  const t = useTranslations('instant.result');
  const format = useFormatter();
  const [copied, setCopied] = useState(false);

  const meta = CHANNEL_META[item.channel] ?? { Icon: BookOpen, color: 'text-muted-foreground' };
  const { Icon, color } = meta;
  /*
    An unknown channel falls back to the raw value from the API rather than to
    a translated label that would be a lie about what was generated.
  */
  const label = item.channel in CHANNEL_META ? t(item.channel as never) : item.channel;

  async function handleCopy() {
    await navigator.clipboard.writeText(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Top accent gradient bar */}
      <div className="absolute inset-x-0 top-0 h-1 bg-saffron" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Icon className={cn('h-4 w-4', color)} />
          <span className="text-sm font-medium">{label}</span>
          {item.tone && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize">
              {item.tone}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
              copied
                ? 'border-moss-700 bg-chalk-sunk text-moss-700'
                : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
            )}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                {t('copied')}
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                {t('copy')}
              </>
            )}
          </button>
          <button
            onClick={onReset}
            title={t('regenerate')}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            {t('new')}
          </button>
        </div>
      </div>

      {/* ── Topic label ─────────────────────────────────────────────────── */}
      <div className="border-b border-border/50 px-5 py-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/60">{t('topicLabel')}</span>
          <bdi>{item.topic}</bdi>
        </p>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-5">
        {/*
          `dir="auto"` because the generated post is not necessarily in the
          locale's language: an English draft inside a Persian page has to keep
          its own direction, or its punctuation ends up on the wrong end.
        */}
        <pre dir="auto" className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
          {item.content}
        </pre>
      </div>

      {/* ── Footer metadata ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border/50 px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {t('creditsUsed', { count: item.creditsCost ?? 0 })}
          </span>
          {creditsRemaining !== undefined && (
            <span className="text-[11px] font-medium text-moss-700">
              {t('creditsRemaining', { count: creditsRemaining })}
            </span>
          )}
        </div>
        {/* Through the formatter, so a Persian reader gets Persian digits and
            Tehran time rather than the browser's idea of both. */}
        <span className="text-[11px] text-muted-foreground">
          {format.dateTime(new Date(item.createdAt), { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

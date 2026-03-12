'use client';

import { useState } from 'react';
import { Check, Copy, RefreshCw, Linkedin, Twitter, Mail, BookOpen, Camera } from 'lucide-react';
import type { ContentItem } from '@contivo/types';

import { cn } from '@/lib/utils';

// ─── Channel → icon + label ───────────────────────────────────────────────────

const CHANNEL_META: Record<
  string,
  { label: string; Icon: React.ElementType; color: string }
> = {
  linkedin: { label: 'LinkedIn Post', Icon: Linkedin, color: 'text-blue-400' },
  twitter: { label: 'X Thread', Icon: Twitter, color: 'text-sky-400' },
  instagram: { label: 'Instagram Caption', Icon: Camera, color: 'text-pink-400' },
  email: { label: 'Email Draft', Icon: Mail, color: 'text-violet-400' },
  blog: { label: 'Blog Outline', Icon: BookOpen, color: 'text-emerald-400' },
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
  const [copied, setCopied] = useState(false);

  const meta = CHANNEL_META[item.channel] ?? {
    label: item.channel,
    Icon: BookOpen,
    color: 'text-muted-foreground',
  };
  const { label, Icon, color } = meta;

  async function handleCopy() {
    await navigator.clipboard.writeText(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Top accent gradient bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient" />

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
                ? 'border-green-500/40 bg-green-500/10 text-green-400'
                : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
            )}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
          <button
            onClick={onReset}
            title="Generate again"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      {/* ── Topic label ─────────────────────────────────────────────────── */}
      <div className="border-b border-border/50 px-5 py-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/60">Topic: </span>
          {item.topic}
        </p>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-5">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
          {item.content}
        </pre>
      </div>

      {/* ── Footer metadata ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border/50 px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {item.creditsCost} credit{item.creditsCost !== 1 ? 's' : ''} used
          </span>
          {creditsRemaining !== undefined && (
            <span className="text-[11px] font-medium text-brand-cyan">
              {creditsRemaining} remaining
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {new Date(item.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}

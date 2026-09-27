'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink as ExternalLinkIcon, Info, Loader2 } from 'lucide-react';

import type { CompetitorLabel, CompetitorType } from '@/lib/competitors/types';
import { competitorBasisNotice, domainHref, safeExternalHref } from './competitor-discovery-logic';

/**
 * Small pieces shared by the review queue and the accepted list. Every
 * string these render that came from a competitor's website, a search
 * result or the judge (names, domains, titles, snippets) is rendered as a
 * React text node, never as HTML.
 */

export const COMPETITOR_TYPES: readonly CompetitorType[] = ['DIRECT', 'INDIRECT', 'ASPIRATIONAL'];

/** An external link, or plain text when the URL is not http(s). Opens in a new tab without an opener. */
export function SafeExternalLink({
  url,
  children,
  className,
}: {
  url: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('growth.competitors');
  const href = safeExternalHref(url);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-2 hover:decoration-moss ${className ?? ''}`}
    >
      {children}
      <ExternalLinkIcon aria-hidden className="h-3 w-3 shrink-0 text-moss-muted" />
      <span className="sr-only">{t('newTab')}</span>
    </a>
  );
}

/** The competitor's domain, linked to its homepage when the domain is a plain hostname. */
export function DomainLink({ domain }: { domain: string | null }) {
  const t = useTranslations('growth.competitors');
  if (!domain) return <span className="text-xs text-moss-muted">{t('noDomain')}</span>;
  const text = (
    <bdi dir="ltr" className="block min-w-0 truncate">
      {domain}
    </bdi>
  );
  const href = domainHref(domain);
  if (!href) return <span className="text-xs text-moss-muted">{text}</span>;
  return (
    <SafeExternalLink url={href} className="min-w-0 text-xs text-moss-muted">
      {text}
    </SafeExternalLink>
  );
}

export function LabelChips({ labels }: { labels: CompetitorLabel[] }) {
  const t = useTranslations('growth.competitors');
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-rival/30 bg-chalk-raised px-2.5 py-0.5 text-[11px] font-semibold text-rival"
        >
          {t(`labels.${label}`)}
        </span>
      ))}
    </>
  );
}

/** Confidence as a word. The number behind it is never shown: it is an estimate, not a measurement. */
export function ConfidenceWord({ band }: { band: 'high' | 'medium' | 'low' | 'unknown' }) {
  const t = useTranslations('growth.competitors');
  const tone =
    band === 'high'
      ? 'border-moss-700/40 text-moss-700'
      : band === 'medium'
        ? 'border-rule-strong text-moss-muted'
        : 'border-rule text-moss-muted';
  return (
    <span className={`rounded-full border bg-chalk-raised px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {t(`confidence.${band}`)}
    </span>
  );
}

export function TypeSelect({
  id,
  value,
  saving,
  onChange,
}: {
  id: string;
  value: CompetitorType;
  saving: boolean;
  onChange: (type: CompetitorType) => void;
}) {
  const t = useTranslations('growth.competitors');
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {t('queue.typeLabel')}
      </label>
      <select
        id={id}
        value={value}
        disabled={saving}
        onChange={(event) => {
          const next = COMPETITOR_TYPES.find((type) => type === event.target.value);
          if (next) onChange(next);
        }}
        className="rounded-lg border border-rule-strong bg-chalk-raised px-2.5 py-1.5 text-xs font-semibold text-moss focus:border-moss focus:outline-none disabled:opacity-60"
      >
        {COMPETITOR_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`types.${type}`)}
          </option>
        ))}
      </select>
      {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-moss-muted" /> : null}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      {children}
    </div>
  );
}

export function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-saffron bg-saffron-soft px-4 py-3 text-sm text-saffron-ink">
      {children}
    </div>
  );
}

/**
 * The note Matrices, Keywords and Offerings show about which competitors a
 * result was built on (spec D8). Renders nothing for an accepted basis or
 * when there is no result yet.
 */
export function CompetitorBasisNote({ payload }: { payload: unknown }) {
  const t = useTranslations('growth.competitors');
  const notice = competitorBasisNotice(payload);
  if (notice === 'none') return null;
  if (notice === 'unconfirmed') {
    return <WarningNote>{t('basis.unconfirmed')}</WarningNote>;
  }
  return (
    <p role="note" className="flex items-start gap-2 text-xs leading-relaxed text-moss-muted">
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{t('basis.legacy')}</span>
    </p>
  );
}

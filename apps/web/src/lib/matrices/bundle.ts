/**
 * The evidence the scorer is allowed to cite, gathered once per run.
 *
 * Every score must point at ids that exist in this bundle, so the ids are
 * either the stable ones stored on the competitor's evidence or `own:` ids
 * derived from the workspace's brand summary. Nothing here is invented.
 */
import { createHash } from 'node:crypto';

import { parseStoredEvidence } from '@/lib/competitors/pipeline';

import type { CompanyType } from './types';

export type BundleEvidence = { id: string; kind: string; text: string };
export type BundleCompany = {
  companyId: string; // competitor id, or 'TARGET'
  competitorId: string | null; // null for the target
  name: string;
  domain: string;
  type: CompanyType;
  positioning: string | null;
  keyFeatures: string[];
  labels: string[];
  keywordThemes: string[]; // from competitorKeywordsIntel, [] when absent or empty
  evidence: BundleEvidence[];
};
export type EvidenceBundle = { target: BundleCompany; competitors: BundleCompany[] };

const MAX_EVIDENCE = 12;
const MAX_TEXT = 300;
const MAX_THEMES = 10;
const TYPES: CompanyType[] = ['TARGET', 'DIRECT', 'INDIRECT', 'ASPIRATIONAL'];

/** Lower-case, no protocol, no `www.`, no path: the form both sides are compared in. */
function normaliseDomain(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * A brand-summary item's id is its content, not its position: `own:` plus the
 * first 8 hex of sha256(text). A positional id (`own:offers:1`) pointed at a
 * different sentence as soon as the summary was reordered or edited, so an old
 * score would quietly cite something it never read.
 */
export function ownEvidenceId(text: string): string {
  return `own:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}

/**
 * A model will happily cite a field that is only whitespace, so empties never
 * become evidence; the same sentence in two fields is one item.
 */
export function ownEvidence(brandSummary: unknown): BundleEvidence[] {
  if (!isRecord(brandSummary)) return [];
  const items: BundleEvidence[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const id = ownEvidenceId(text);
    if (seen.has(id)) return;
    seen.add(id);
    items.push({ id, kind: 'own', text });
  };
  for (const value of Object.values(brandSummary)) {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) for (const entry of value) if (typeof entry === 'string') add(entry);
  }
  return items.slice(0, MAX_EVIDENCE);
}

export function hasBrandSummary(brandSummary: unknown): boolean {
  return ownEvidence(brandSummary).length > 0;
}

function competitorEvidence(stored: unknown): BundleEvidence[] {
  const items: BundleEvidence[] = [];
  for (const item of parseStoredEvidence(stored)) {
    const text = [item.title, item.snippet].filter(Boolean).join(' — ').slice(0, MAX_TEXT);
    if (text) items.push({ id: item.id, kind: item.kind, text });
  }
  return items.slice(0, MAX_EVIDENCE);
}

/** Theme lists keyed by normalised domain; entries with no keywords at all are skipped. */
function keywordThemesByDomain(audienceInsights: unknown): Map<string, string[]> {
  const themes = new Map<string, string[]>();
  if (!isRecord(audienceInsights)) return themes;
  const intel = audienceInsights.competitorKeywordsIntel;
  if (!isRecord(intel) || !Array.isArray(intel.competitors)) return themes;
  for (const entry of intel.competitors) {
    if (!isRecord(entry) || typeof entry.domain !== 'string') continue;
    const primary = stringList(entry.primary_keywords);
    const clusters = Array.isArray(entry.keyword_clusters)
      ? entry.keyword_clusters.flatMap((c) => (isRecord(c) && typeof c.cluster === 'string' && c.cluster.trim() ? [c.cluster] : []))
      : [];
    const list = [...new Set([...primary, ...clusters])].slice(0, MAX_THEMES);
    if (list.length === 0) continue;
    themes.set(normaliseDomain(entry.domain), list);
  }
  return themes;
}

export function buildEvidenceBundle(input: {
  workspace: { name: string; websiteUrl: string | null; brandSummary: unknown; audienceInsights: unknown };
  competitors: Array<{
    id: string;
    name: string;
    domain: string | null;
    type: string | null;
    positioning: string | null;
    keyFeatures: string[];
    labels: string[];
    evidence: unknown;
  }>;
}): EvidenceBundle {
  const { workspace } = input;
  const themes = keywordThemesByDomain(workspace.audienceInsights);
  const targetDomain = normaliseDomain(workspace.websiteUrl);

  const target: BundleCompany = {
    companyId: 'TARGET',
    competitorId: null,
    name: workspace.name,
    domain: targetDomain,
    type: 'TARGET',
    positioning: null,
    keyFeatures: [],
    labels: [],
    keywordThemes: [],
    evidence: ownEvidence(workspace.brandSummary),
  };

  const competitors = input.competitors.map((c): BundleCompany => {
    const domain = normaliseDomain(c.domain);
    const type = TYPES.includes(c.type as CompanyType) && c.type !== 'TARGET' ? (c.type as CompanyType) : 'DIRECT';
    return {
      companyId: c.id,
      competitorId: c.id,
      name: c.name,
      domain,
      type,
      positioning: c.positioning,
      keyFeatures: c.keyFeatures,
      labels: c.labels,
      keywordThemes: themes.get(domain) ?? [],
      evidence: competitorEvidence(c.evidence),
    };
  });

  return { target, competitors };
}

export function evidenceIdsFor(bundle: EvidenceBundle, companyId: string): Set<string> {
  const company = companyId === bundle.target.companyId ? bundle.target : bundle.competitors.find((c) => c.companyId === companyId);
  return new Set((company?.evidence ?? []).map((e) => e.id));
}

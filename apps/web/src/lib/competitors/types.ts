import { randomBytes } from 'node:crypto';

export type TargetMarket = { country: string | null; language: 'fa' | 'en' };

export type EvidenceItem = {
  id: string;              // 8 hex chars, stable across reruns for the same url
  kind: 'citation' | 'serp' | 'site';
  url: string;
  title?: string;
  snippet?: string;
  query?: string;
};

export type CompetitorLabel = 'SEO' | 'BUSINESS';
export type CompetitorSource = 'WEB_SEARCH' | 'SERP' | 'MANUAL';
export type CompetitorType = 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL';

export type Candidate = {
  domain: string;
  frequency: number;          // how many distinct queries surfaced it
  sources: CompetitorSource[];
  evidence: EvidenceItem[];
};

export type EnrichedCandidate = Candidate & {
  siteTitle: string | null;
  siteEvidence: string;       // text block from collectWebsiteEvidence
  pageLanguage: string | null;
};

export type JudgedCandidate = EnrichedCandidate & {
  name: string;
  isCompetitor: boolean;
  labels: CompetitorLabel[];
  type: CompetitorType;
  scaleMatch: boolean;
  judgeConfidence: number;
  reason: string;
  positioning: string | null;
  keyFeatures: string[];
  description: string;
};

export type ScoredCandidate = JudgedCandidate & { finalConfidence: number };

export type SourceHarvestStats = { harvested: number; tokens: number | null; errors: number };

/**
 * Shape of `DiscoveryRun.sourceStats`, the JSON blob `runDiscoveryPipeline`
 * (`./pipeline`) writes incrementally as each stage completes and that the
 * polling UI (Task 10) reads back through `getDiscoveryStatus`. Every field
 * is optional on purpose: a run that failed during SEARCH never gets a
 * `judge` key, and that absence — not a zero — is the honest signal that
 * the stage never ran.
 */
export type SourceStats = {
  queries?: { count: number; tokens: number | null };
  search?: {
    webSearch?: SourceHarvestStats;
    serp?: SourceHarvestStats;
    merged?: number;
  };
  enrich?: {
    input: number;
    enriched: number;
    /** True when the enrich stage's overall wall-clock budget ran out before every candidate was attempted. */
    budgetExceeded?: boolean;
    /** How many candidates were never started because the budget was already spent. */
    skipped?: number;
  };
  judge?: { input: number; judged: number; kept: number; tokens: number | null };
  save?: { saved: number };
  /**
   * Batch/harvest failure messages. These originate upstream (`./judge`,
   * `./search`) and may echo a raw HTTP error body, so anything read out of
   * here for display must be treated as untrusted text — see
   * `sanitizeErrorText` in the actions module that serialises this for the
   * browser.
   */
  errors?: string[];
  tokensIncomplete?: boolean;
  tokensUnknown?: boolean;
};

/** 8 hex chars. Short enough to read in a payload, unique enough within one competitor. */
export function newEvidenceId(): string {
  return randomBytes(4).toString('hex');
}

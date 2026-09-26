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

/** 8 hex chars. Short enough to read in a payload, unique enough within one competitor. */
export function newEvidenceId(): string {
  return randomBytes(4).toString('hex');
}

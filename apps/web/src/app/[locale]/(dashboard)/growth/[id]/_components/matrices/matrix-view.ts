import { confidenceBand } from '@/lib/matrices/scoring';
import type { ProjectedChart, ProjectedCompany, Projection } from '@/lib/matrices/projection';

/**
 * What the page reads. The saved blob is the current `Projection`, or an older
 * shape written before evidence, chart kinds, white space and competitor ids
 * existed. Anything those newer fields carry is optional here: a missing field
 * means "not known", and the component hides what it cannot show rather than
 * inventing it.
 */
export type CompanyView = Omit<
  ProjectedCompany,
  'competitor_id' | 'confidence_band' | 'estimated' | 'evidence' | 'evidence_missing' | 'override'
> &
  Partial<Pick<ProjectedCompany, 'competitor_id' | 'confidence_band' | 'estimated' | 'evidence' | 'evidence_missing' | 'override'>>;

export type ChartView = Omit<ProjectedChart, 'companies' | 'chart_kind' | 'content_angles' | 'white_space'> &
  Partial<Pick<ProjectedChart, 'chart_kind' | 'content_angles' | 'white_space'>> & { companies: CompanyView[] };

export type MatrixView = Omit<
  Projection,
  'charts' | 'run_id' | 'tokens_used' | 'stale' | 'language' | 'target_audience_segment' | 'competitor_basis' | 'source'
> &
  Partial<Pick<Projection, 'run_id' | 'tokens_used' | 'stale' | 'language' | 'target_audience_segment' | 'competitor_basis'>> & {
    charts: ChartView[];
    /** Written by the previous generator; the only place a model name survives. */
    token_usage?: { last_run?: { model?: string; total_tokens?: number } | null } | null;
  };

/** Stable identity of a point within a chart. Names alone can repeat. */
export function companyKey(company: Pick<CompanyView, 'name' | 'website'>): string {
  return `${company.name}::${company.website}`;
}

/** The stored band, or one worked out from the score for blobs that predate it. */
export function bandOf(company: CompanyView): 'high' | 'medium' | 'low' {
  return company.confidence_band ?? confidenceBand(company.confidence_score);
}

/** Only a point that knows its competitor id (or is the target, null) can be overridden. */
export function canOverride(company: CompanyView): boolean {
  return company.competitor_id !== undefined;
}

export function compactDomain(website: string): string {
  return website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

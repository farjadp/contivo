import type { AxisDefinition, MatrixLanguage } from './axes';
import { evidenceIdsFor, type BundleCompany, type EvidenceBundle } from './bundle';
import { MatrixAiError, callStructured } from './openai';
import { axisThird, finalConfidence, isEstimated, normalizeCertainty } from './scoring';
import type { Certainty, MatrixScore } from './types';

export const REASON_MAX_CHARS = 200;
const MAX_EVIDENCE_PER_COMPANY = 12;

export type ScoredCompany = MatrixScore & {
  xReason: string;
  yReason: string;
  evidenceRefs: string[];
  certainty: Certainty;
};

const SCORE = { type: 'integer', minimum: 1, maximum: 10 } as const;

export const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['companies'],
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company_id', 'x_score', 'y_score', 'x_reason', 'y_reason', 'evidence_refs', 'certainty'],
        properties: {
          company_id: { type: 'string' },
          x_score: SCORE,
          y_score: SCORE,
          x_reason: { type: 'string' },
          y_reason: { type: 'string' },
          evidence_refs: { type: 'array', items: { type: 'string' } },
          certainty: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

const LANGUAGE_NAME: Record<MatrixLanguage, string> = { fa: 'Persian', en: 'English' };

function describeCompany(c: BundleCompany): string {
  return [
    `## company_id: ${c.companyId} — ${c.name} (${c.domain}) [${c.type}]`,
    `Positioning: ${c.positioning ?? 'none'}`,
    `Key features: ${c.keyFeatures.join('; ') || 'none'}`,
    `Labels: ${c.labels.join(', ') || 'none'}`,
    `Keyword themes: ${c.keywordThemes.join(', ') || 'none'}`,
    'Evidence (cite the id in brackets):',
    ...(c.evidence.length
      ? c.evidence.slice(0, MAX_EVIDENCE_PER_COMPANY).map((e) => `- [${e.id}] (${e.kind}) ${e.text}`)
      : ['- none']),
  ].join('\n');
}

export function buildScorePrompt(
  bundle: EvidenceBundle,
  axis: AxisDefinition,
  language: MatrixLanguage,
): { system: string; user: string } {
  const system = [
    'You place companies on one positioning chart. Score every company on two axes from 1 to 10, using only the evidence given.',
    `X axis: ${axis.x.label}. 1 = ${axis.x.low}. 10 = ${axis.x.high}.`,
    `Y axis: ${axis.y.label}. 1 = ${axis.y.low}. 10 = ${axis.y.high}.`,
    'Use the whole 1-10 range; the two ends above are the rubric.',
    'Score the target from its own evidence; do not default it to the middle. It is scored on the same scale as every competitor.',
    'Return exactly one entry per company, using each company_id exactly as given (the target is TARGET). Do not omit or repeat any company.',
    'certainty says how well the evidence supports the pair of scores: "certain" = the evidence states it directly; "likely" = it clearly points that way; "unsure" = little evidence, mostly judgment. Do not output a number.',
    'evidence_refs: cite evidence ids exactly as given, and only ids listed under that same company. Cite nothing rather than invent an id; an empty list is allowed.',
    `x_reason and y_reason: at most ${REASON_MAX_CHARS} characters each, one sentence, grounded in the evidence. When you cite evidence, never use the words "estimated" or "inferred".`,
    `Write every reason in ${LANGUAGE_NAME[language]}.`,
  ].join('\n');
  const user = [
    `Chart: ${axis.name}`,
    '',
    'Target company:',
    describeCompany(bundle.target),
    '',
    'Competitors:',
    ...bundle.competitors.map(describeCompany),
  ].join('\n');
  return { system, user };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, REASON_MAX_CHARS) : '';
}

export async function scoreChart(
  bundle: EvidenceBundle,
  axis: AxisDefinition,
  language: MatrixLanguage,
): Promise<{ scores: ScoredCompany[]; tokens: number | null }> {
  const { system, user } = buildScorePrompt(bundle, axis, language);
  const { data, tokens } = await callStructured<{ companies?: unknown }>({
    name: 'chart_scores',
    schema: SCORE_SCHEMA,
    system,
    user,
  });

  const rows = data?.companies;
  if (!Array.isArray(rows)) throw new MatrixAiError('chart scoring returned no companies array', tokens);

  const expected = [bundle.target, ...bundle.competitors];
  const byId = new Map(expected.map((c) => [c.companyId, c]));
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = isRecord(row) && typeof row.company_id === 'string' ? row.company_id : null;
    if (!id || !byId.has(id)) throw new MatrixAiError(`chart scoring returned an unknown company: ${String(id)}`, tokens);
    if (seen.has(id)) throw new MatrixAiError(`chart scoring returned company ${id} more than once`, tokens);
    seen.set(id, row as Record<string, unknown>);
  }

  const scores = expected.map((company): ScoredCompany => {
    const row = seen.get(company.companyId);
    if (!row) throw new MatrixAiError(`chart scoring omitted company ${company.companyId}`, tokens);
    if (!validScore(row.x_score) || !validScore(row.y_score)) {
      throw new MatrixAiError(`chart scoring gave company ${company.companyId} a score outside 1-10`, tokens);
    }
    const allowed = evidenceIdsFor(bundle, company.companyId);
    const refs = [
      ...new Set(
        (Array.isArray(row.evidence_refs) ? row.evidence_refs : []).filter(
          (r): r is string => typeof r === 'string' && allowed.has(r),
        ),
      ),
    ];
    const certainty = normalizeCertainty(row.certainty);
    return {
      competitorId: company.competitorId,
      name: company.name,
      domain: company.domain,
      type: company.type,
      xScore: row.x_score,
      yScore: row.y_score,
      confidence: finalConfidence({ certainty, evidenceCount: refs.length }),
      estimated: isEstimated(refs.length),
      xReason: text(row.x_reason),
      yReason: text(row.y_reason),
      evidenceRefs: refs,
      certainty,
    };
  });

  return { scores, tokens };
}

/**
 * Two core charts agree about a company when it lands in the same (x third,
 * y third) cell on both. Only those companies get the agreement bonus; the
 * rest, and every estimated score, keep what they had.
 */
export function applyCoreAgreement(coreA: ScoredCompany[], coreB: ScoredCompany[]): [ScoredCompany[], ScoredCompany[]] {
  const cell = (s: ScoredCompany) => `${axisThird(s.xScore)}:${axisThird(s.yScore)}`;
  const key = (s: ScoredCompany) => s.competitorId ?? 'TARGET';
  const cellsB = new Map(coreB.map((s) => [key(s), cell(s)]));
  const lift = (list: ScoredCompany[], other: Map<string, string>) =>
    list.map((s) =>
      other.get(key(s)) === cell(s)
        ? {
            ...s,
            confidence: finalConfidence({ certainty: s.certainty, evidenceCount: s.evidenceRefs.length, coreChartsAgree: true }),
          }
        : s,
    );
  const cellsA = new Map(coreA.map((s) => [key(s), cell(s)]));
  return [lift(coreA, cellsB), lift(coreB, cellsA)];
}

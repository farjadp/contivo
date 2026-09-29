import { coreAxes, normaliseMarketAxes, type MatrixLanguage, type StoredMarketAxis } from './axes';
import type { BundleCompany, EvidenceBundle } from './bundle';
import { MatrixAiError, callStructured } from './openai';

const CANDIDATES = 4;
const MIN_USABLE = 2;
const MAX_EVIDENCE_PER_COMPANY = 5;

const END = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'low', 'high'],
  properties: { label: { type: 'string' }, low: { type: 'string' }, high: { type: 'string' } },
} as const;

export const AXIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      minItems: CANDIDATES,
      maxItems: CANDIDATES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'x', 'y', 'rationale', 'evidence_fields'],
        properties: {
          key: { type: 'string' },
          x: END,
          y: END,
          rationale: { type: 'string' },
          evidence_fields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

const LANGUAGE_NAME: Record<MatrixLanguage, string> = { fa: 'Persian', en: 'English' };

function describeCompany(c: BundleCompany): string {
  const lines = [
    `## ${c.name} (${c.domain})`,
    `Positioning: ${c.positioning ?? 'none'}`,
    `Key features: ${c.keyFeatures.join('; ') || 'none'}`,
    `Labels: ${c.labels.join(', ') || 'none'}`,
    'Evidence:',
    ...c.evidence.slice(0, MAX_EVIDENCE_PER_COMPANY).map((e) => `- [${e.kind}] ${e.text}`),
  ];
  return lines.join('\n');
}

export function buildAxisPrompt(
  bundle: EvidenceBundle,
  language: MatrixLanguage,
  brief: { brandName: string; targetCountry: string | null },
): { system: string; user: string } {
  const core = coreAxes(language)
    .map((a) => `- ${a.x.label} / ${a.y.label} (${a.key})`)
    .join('\n');
  const system = [
    `You propose ${CANDIDATES} candidate axis pairs for a competitor positioning matrix. Each pair has an X axis and a Y axis, each with a label and a low and high end.`,
    'Rules:',
    '- Both ends of every axis must be observable in the evidence provided; never rely on facts you would have to guess.',
    `- Do not duplicate the two core axes already plotted:\n${core}`,
    '- No abstract axes such as "strategy", "creativity" or "execution".',
    '- Every label must be at most 40 characters.',
    '- The rationale is one sentence.',
    '- key is a short lowercase snake_case identifier in English letters, unique per candidate.',
    '- evidence_fields lists which fields (positioning, key features, labels, evidence) the axis relies on.',
    `Write every label and rationale in ${LANGUAGE_NAME[language]}.`,
  ].join('\n');
  const user = [
    `Brand: ${brief.brandName}`,
    `Target country: ${brief.targetCountry ?? 'not specified'}`,
    '',
    'Target company:',
    describeCompany(bundle.target),
    '',
    'Competitors:',
    ...bundle.competitors.map(describeCompany),
  ].join('\n');
  return { system, user };
}

export async function proposeMarketAxes(
  bundle: EvidenceBundle,
  language: MatrixLanguage,
  brief: { brandName: string; targetCountry: string | null },
): Promise<{ candidates: StoredMarketAxis[]; tokens: number | null }> {
  const { system, user } = buildAxisPrompt(bundle, language, brief);
  const { data, tokens } = await callStructured<{ candidates?: unknown }>({
    name: 'market_axis_candidates',
    schema: AXIS_SCHEMA,
    system,
    user,
  });
  const candidates = normaliseMarketAxes(data?.candidates, CANDIDATES);
  if (candidates.length < MIN_USABLE) {
    throw new MatrixAiError('axis proposal returned fewer than 2 usable candidates', tokens);
  }
  return { candidates, tokens };
}

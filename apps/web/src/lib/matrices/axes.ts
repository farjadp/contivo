/**
 * The axes a matrix run plots: two core pairs every workspace shares, plus up
 * to three market pairs chosen for the workspace.
 *
 * Core labels live in the message files so they are translated once, in one
 * place; market labels are written by the model in the workspace's language and
 * stored as-is.
 */
import en from '../../../messages/en/tabs-b.json';
import fa from '../../../messages/fa/tabs-b.json';
import type { ChartKind } from './types';

export type MatrixLanguage = 'fa' | 'en';

/** Workspaces store their content language as 'FA' | 'EN'; anything else reads as English. */
export function languageFromContent(contentLanguage: string | null | undefined): MatrixLanguage {
  return contentLanguage === 'FA' ? 'fa' : 'en';
}

type AxisEnd = { label: string; low: string; high: string };

export type AxisDefinition = {
  key: string;
  kind: ChartKind;
  name: string;
  x: AxisEnd;
  y: AxisEnd;
};

export const CORE_AXIS_KEYS = ['offer_breadth_specialization', 'content_presence_focus'] as const;

const MESSAGES = { en, fa } as const;

export function coreAxes(language: MatrixLanguage): AxisDefinition[] {
  const labels = MESSAGES[language].tabsB.matrices.coreAxes;
  return CORE_AXIS_KEYS.map((key) => ({ key, kind: 'CORE' as const, ...labels[key] }));
}

export type StoredMarketAxis = {
  key: string;
  x: AxisEnd;
  y: AxisEnd;
  rationale: string;
};

const MAX_MARKET_AXES = 3;
const MAX_KEY_LENGTH = 60;
/** Axis wording arrives from the client (the chooser) as well as the model, so it is bounded here. */
const MAX_LABEL_LENGTH = 60;
const MAX_RATIONALE_LENGTH = 300;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, max = Number.POSITIVE_INFINITY): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

function parseEnd(v: unknown): AxisEnd | null {
  if (!isRecord(v)) return null;
  const label = text(v.label, MAX_LABEL_LENGTH);
  const low = text(v.low, MAX_LABEL_LENGTH);
  const high = text(v.high, MAX_LABEL_LENGTH);
  return label && low && high ? { label, low, high } : null;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/, '');
}

/**
 * Reads market axes back out of storage. The column is JSON a model once wrote,
 * so anything malformed is dropped rather than trusted, and keys are made safe
 * to use as chart ids: unique, and never one of the core keys.
 */
export function parseStoredMarketAxes(value: unknown): StoredMarketAxis[] {
  return normaliseMarketAxes(value, MAX_MARKET_AXES);
}

/** The shared slug and validation rules, with the cap chosen by the caller (proposals keep 4). */
export function normaliseMarketAxes(value: unknown, limit: number): StoredMarketAxis[] {
  if (!Array.isArray(value)) return [];
  const taken = new Set<string>(CORE_AXIS_KEYS);
  const out: StoredMarketAxis[] = [];
  for (const entry of value) {
    if (out.length >= limit) break;
    if (!isRecord(entry)) continue;
    const rawKey = text(entry.key);
    const x = parseEnd(entry.x);
    const y = parseEnd(entry.y);
    if (!rawKey || !x || !y) continue;
    const base = slugify(rawKey);
    if (!base || (CORE_AXIS_KEYS as readonly string[]).includes(base)) continue;
    let key = base;
    for (let n = 2; taken.has(key); n++) {
      const suffix = `_${n}`;
      key = `${base.slice(0, MAX_KEY_LENGTH - suffix.length)}${suffix}`;
    }
    taken.add(key);
    out.push({ key, x, y, rationale: text(entry.rationale, MAX_RATIONALE_LENGTH) ?? '' });
  }
  return out;
}

/** Core axes first, in a fixed order, then the workspace's market axes. */
export function axesForRun(language: MatrixLanguage, market: StoredMarketAxis[]): AxisDefinition[] {
  return [
    ...coreAxes(language),
    ...market.map((axis) => ({
      key: axis.key,
      kind: 'MARKET' as const,
      name: `${axis.x.label} / ${axis.y.label}`,
      x: axis.x,
      y: axis.y,
    })),
  ];
}

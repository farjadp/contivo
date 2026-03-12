import { prisma } from '@/lib/db';
import {
  type ContentWordCountLimits,
  normalizeWordCountLimits,
} from '@/lib/content-word-count';

const GEMINI_MODEL_KEY = 'gemini_model';
const COMPETITIVE_LANDSCAPE_LIMIT_KEY = 'competitive_landscape_limit';
const BRAND_MEMORY_LIMIT_KEY = 'brand_memory_rescrape_limit';
const IDEATION_MAX_CONTENT_COUNT_KEY = 'ideation_max_content_count';
const CONTENT_WORD_COUNT_LIMITS_KEY = 'content_word_count_limits';
const DEFAULT_GEMINI_MODEL = 'gemini-3-pro-preview';
const DEFAULT_COMPETITIVE_LANDSCAPE_LIMIT = 3;
const DEFAULT_BRAND_MEMORY_LIMIT = 3;
const DEFAULT_IDEATION_MAX_CONTENT_COUNT = 10;
const CACHE_TTL_MS = 30_000;
const LEGACY_GEMINI_MODELS = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-lite']);

let ensureSettingsTablePromise: Promise<void> | null = null;
let geminiModelCache: { value: string; expiresAt: number } | null = null;
let competitiveLandscapeLimitCache: { value: number; expiresAt: number } | null = null;
let brandMemoryLimitCache: { value: number; expiresAt: number } | null = null;
let ideationMaxContentCountCache: { value: number; expiresAt: number } | null = null;
let contentWordCountLimitsCache: { value: ContentWordCountLimits; expiresAt: number } | null = null;

export const GEMINI_MODEL_PRESETS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
] as const;

export const PLATFORM_LIMIT_MIN = 1;
export const PLATFORM_LIMIT_MAX = 20;

async function ensureSettingsTable(): Promise<void> {
  if (ensureSettingsTablePromise) {
    return ensureSettingsTablePromise;
  }

  ensureSettingsTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
    .then(() => undefined)
    .catch((error) => {
      ensureSettingsTablePromise = null;
      throw error;
    });

  return ensureSettingsTablePromise;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    await ensureSettingsTable();
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value
      FROM app_settings
      WHERE key = ${key}
      LIMIT 1
    `;
    return rows[0]?.value ?? null;
  } catch (error) {
    console.error('Failed to read app setting:', error);
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await ensureSettingsTable();
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

function normalizeLimit(
  raw: string | null | undefined,
  fallback: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(PLATFORM_LIMIT_MIN, Math.min(PLATFORM_LIMIT_MAX, parsed));
}

export async function getGeminiModel(): Promise<string> {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel) {
    if (LEGACY_GEMINI_MODELS.has(envModel)) {
      return DEFAULT_GEMINI_MODEL;
    }
    return envModel;
  }

  const now = Date.now();
  if (geminiModelCache && geminiModelCache.expiresAt > now) {
    return geminiModelCache.value;
  }

  const persistedModel = (await readSetting(GEMINI_MODEL_KEY))?.trim();
  let model = persistedModel || DEFAULT_GEMINI_MODEL;
  if (persistedModel && LEGACY_GEMINI_MODELS.has(persistedModel)) {
    model = DEFAULT_GEMINI_MODEL;
    writeSetting(GEMINI_MODEL_KEY, model).catch((error) => {
      console.error('Failed to auto-upgrade Gemini model setting:', error);
    });
  }

  geminiModelCache = {
    value: model,
    expiresAt: now + CACHE_TTL_MS,
  };

  return model;
}

export async function setGeminiModel(model: string): Promise<void> {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    throw new Error('Gemini model cannot be empty.');
  }

  await writeSetting(GEMINI_MODEL_KEY, normalizedModel);
  geminiModelCache = {
    value: normalizedModel,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

export async function getCompetitiveLandscapeLimit(): Promise<number> {
  const envLimit = normalizeLimit(
    process.env.COMPETITIVE_LANDSCAPE_LIMIT || process.env.COMPETITIVE_DISCOVERY_LIMIT,
    0,
  );
  if (envLimit >= PLATFORM_LIMIT_MIN) return envLimit;

  const now = Date.now();
  if (competitiveLandscapeLimitCache && competitiveLandscapeLimitCache.expiresAt > now) {
    return competitiveLandscapeLimitCache.value;
  }

  const persisted = await readSetting(COMPETITIVE_LANDSCAPE_LIMIT_KEY);
  const value = normalizeLimit(persisted, DEFAULT_COMPETITIVE_LANDSCAPE_LIMIT);
  competitiveLandscapeLimitCache = {
    value,
    expiresAt: now + CACHE_TTL_MS,
  };
  return value;
}

export async function setCompetitiveLandscapeLimit(limit: number): Promise<void> {
  const value = Math.max(PLATFORM_LIMIT_MIN, Math.min(PLATFORM_LIMIT_MAX, Math.floor(limit)));
  await writeSetting(COMPETITIVE_LANDSCAPE_LIMIT_KEY, String(value));
  competitiveLandscapeLimitCache = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

export async function getBrandMemoryRescrapeLimit(): Promise<number> {
  const envLimit = normalizeLimit(process.env.BRAND_MEMORY_RESCRAPE_LIMIT, 0);
  if (envLimit >= PLATFORM_LIMIT_MIN) return envLimit;

  const now = Date.now();
  if (brandMemoryLimitCache && brandMemoryLimitCache.expiresAt > now) {
    return brandMemoryLimitCache.value;
  }

  const persisted = await readSetting(BRAND_MEMORY_LIMIT_KEY);
  const value = normalizeLimit(persisted, DEFAULT_BRAND_MEMORY_LIMIT);
  brandMemoryLimitCache = {
    value,
    expiresAt: now + CACHE_TTL_MS,
  };
  return value;
}

export async function setBrandMemoryRescrapeLimit(limit: number): Promise<void> {
  const value = Math.max(PLATFORM_LIMIT_MIN, Math.min(PLATFORM_LIMIT_MAX, Math.floor(limit)));
  await writeSetting(BRAND_MEMORY_LIMIT_KEY, String(value));
  brandMemoryLimitCache = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

export async function getIdeationMaxContentCount(): Promise<number> {
  const envLimit = normalizeLimit(process.env.IDEATION_MAX_CONTENT_COUNT, 0);
  if (envLimit >= PLATFORM_LIMIT_MIN) return envLimit;

  const now = Date.now();
  if (ideationMaxContentCountCache && ideationMaxContentCountCache.expiresAt > now) {
    return ideationMaxContentCountCache.value;
  }

  const persisted = await readSetting(IDEATION_MAX_CONTENT_COUNT_KEY);
  const value = normalizeLimit(persisted, DEFAULT_IDEATION_MAX_CONTENT_COUNT);
  ideationMaxContentCountCache = {
    value,
    expiresAt: now + CACHE_TTL_MS,
  };
  return value;
}

export async function setIdeationMaxContentCount(limit: number): Promise<void> {
  const value = Math.max(PLATFORM_LIMIT_MIN, Math.min(PLATFORM_LIMIT_MAX, Math.floor(limit)));
  await writeSetting(IDEATION_MAX_CONTENT_COUNT_KEY, String(value));
  ideationMaxContentCountCache = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

function safeParseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getContentWordCountLimits(): Promise<ContentWordCountLimits> {
  const now = Date.now();
  if (contentWordCountLimitsCache && contentWordCountLimitsCache.expiresAt > now) {
    return contentWordCountLimitsCache.value;
  }

  const persistedRaw = await readSetting(CONTENT_WORD_COUNT_LIMITS_KEY);
  const value = normalizeWordCountLimits(safeParseJson(persistedRaw));
  contentWordCountLimitsCache = {
    value,
    expiresAt: now + CACHE_TTL_MS,
  };
  return value;
}

export async function setContentWordCountLimits(limits: ContentWordCountLimits): Promise<void> {
  const normalized = normalizeWordCountLimits(limits);
  await writeSetting(CONTENT_WORD_COUNT_LIMITS_KEY, JSON.stringify(normalized));
  contentWordCountLimitsCache = {
    value: normalized,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

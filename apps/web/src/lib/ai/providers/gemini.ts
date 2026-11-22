/**
 * Gemini adapter (generateContent). Same request as lib/gemini.ts callGemini,
 * plus: systemInstruction when a system prompt is given, responseSchema for
 * json_schema output, Google Search grounding for web search.
 *
 * The key goes in the x-goog-api-key header, not the URL, so it can never
 * end up in a logged URL or error message.
 *
 * responseSchema is an OpenAPI subset: it rejects `additionalProperties`
 * (recorded 400 in __fixtures__/gemini-400-additional-properties.json), so
 * schemas are converted. The layer validates the reply against the ORIGINAL
 * schema afterwards (run.ts), so the looser Gemini schema cannot let a
 * wrong shape through.
 */

import { parseGeminiUsage, resolveResponseModel } from '@/lib/ai-usage';

import { AiProviderError, classifyGemini, classifyThrown } from '../errors';
import type { AiRequest, AiWebSearchResult, ProviderAdapter, ProviderCallInput, ProviderSuccess } from '../types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Keys Gemini's Schema object accepts; everything else is dropped. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'minLength',
  'maxLength',
  'pattern',
  'anyOf',
  'propertyOrdering',
  'items',
  'minimum',
  'maximum',
]);

/**
 * JSON Schema → Gemini responseSchema: drops unsupported keys (incl.
 * additionalProperties) recursively, turns `type: ["x","null"]` into
 * `type: "x", nullable: true`, `const` into a one-value enum, and adds
 * `propertyOrdering` from the schema's key order.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const input = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'type' && Array.isArray(value)) {
      const nonNull = value.filter((t) => t !== 'null');
      if (nonNull.length !== value.length) out.nullable = true;
      out.type = nonNull[0] ?? 'string';
      continue;
    }
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, toGeminiSchema(child)]),
      );
      // Gemini orders output keys alphabetically unless told; keep the schema's order.
      if (input.propertyOrdering === undefined) out.propertyOrdering = Object.keys(value as Record<string, unknown>);
      continue;
    }
    if (key === 'items' || key === 'anyOf') {
      out[key] = toGeminiSchema(value);
      continue;
    }
    out[key] = value;
  }
  if (Array.isArray(out.enum) && out.type === undefined) out.type = 'string';
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function requestBody(request: AiRequest): Record<string, unknown> {
  const turns = typeof request.prompt === 'string' ? [{ role: 'user' as const, content: request.prompt }] : request.prompt;
  const body: Record<string, unknown> = {
    contents: turns.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] })),
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };

  const generationConfig: Record<string, unknown> = {};
  // Grounding with a JSON mime type is rejected by some models; with web
  // search the reply is parsed (and validated) from plain text instead.
  if (!request.webSearch && request.output.kind !== 'text') generationConfig.responseMimeType = 'application/json';
  if (!request.webSearch && request.output.kind === 'json_schema') {
    generationConfig.responseSchema = toGeminiSchema(request.output.schema);
  }
  if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  if (request.webSearch) body.tools = [{ google_search: {} }];
  return body;
}

const REFUSAL_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);
const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const DOMAIN_LIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

/**
 * Grounding chunks carry redirect links (vertexaisearch.cloud.google.com/…)
 * whose `title` is the source site's domain. A redirect link is useless as a
 * competitor URL, so it is replaced by https://<title>/ when the title is a
 * domain, and dropped otherwise — never guessed.
 */
function groundingUrl(uri: string, title: string | undefined): string | null {
  let host = '';
  try {
    host = new URL(uri).hostname;
  } catch {
    return null;
  }
  if (host !== GROUNDING_REDIRECT_HOST) return uri;
  return title && DOMAIN_LIKE.test(title.trim()) ? `https://${title.trim().toLowerCase()}/` : null;
}

export function parseGeminiGrounding(candidate: unknown): AiWebSearchResult {
  const meta = asRecord(asRecord(candidate)?.groundingMetadata);
  const chunks = Array.isArray(meta?.groundingChunks) ? (meta!.groundingChunks as unknown[]) : [];
  const supports = Array.isArray(meta?.groundingSupports) ? (meta!.groundingSupports as unknown[]) : [];
  const queries = Array.isArray(meta?.webSearchQueries) ? (meta!.webSearchQueries as unknown[]) : [];

  const resolved = chunks.map((chunk) => {
    const web = asRecord(asRecord(chunk)?.web);
    const uri = typeof web?.uri === 'string' ? web.uri : '';
    const title = typeof web?.title === 'string' ? web.title : undefined;
    const url = uri ? groundingUrl(uri, title) : null;
    return url ? { url, title } : null;
  });

  const cited = new Set<number>();
  for (const support of supports) {
    const indices = asRecord(support)?.groundingChunkIndices;
    if (Array.isArray(indices)) for (const index of indices) if (typeof index === 'number') cited.add(index);
  }

  const citations: Array<{ url: string; title?: string }> = [];
  for (const index of [...cited].sort((a, b) => a - b)) {
    const entry = resolved[index];
    if (entry) citations.push(entry);
  }

  return {
    query: typeof queries[0] === 'string' ? (queries[0] as string) : '',
    citations,
    sourceUrls: resolved.flatMap((e) => (e ? [e.url] : [])),
  };
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  async call({ request, model, apiKey }: ProviderCallInput): Promise<ProviderSuccess> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(request.timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody(request)),
      });
    } catch (error) {
      throw classifyThrown('gemini', error);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw classifyGemini(res.status, text);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch (error) {
      throw new AiProviderError({
        provider: 'gemini',
        errorClass: 'invalid_output',
        status: res.status,
        message: `unreadable JSON body: ${(error as Error).message}`,
      });
    }

    const blockReason = asRecord(asRecord(data)?.promptFeedback)?.blockReason;
    const candidate = (asRecord(data)?.candidates as unknown[] | undefined)?.[0];
    const finishReason = asRecord(candidate)?.finishReason;
    if (typeof blockReason === 'string' || (typeof finishReason === 'string' && REFUSAL_FINISH.has(finishReason))) {
      throw new AiProviderError({
        provider: 'gemini',
        errorClass: 'refusal',
        status: 200,
        message: `Gemini blocked the request (${String(blockReason ?? finishReason)})`,
      });
    }

    const parts = asRecord(asRecord(candidate)?.content)?.parts;
    const text = Array.isArray(parts)
      ? parts
          .map((part) => asRecord(part))
          .filter((part) => part && part.thought !== true && typeof part.text === 'string')
          .map((part) => part!.text as string)
          .join('')
      : '';

    return {
      model: resolveResponseModel(data, model),
      text,
      usage: parseGeminiUsage(data),
      ...(request.webSearch ? { webSearch: parseGeminiGrounding(candidate) } : {}),
    };
  },
};

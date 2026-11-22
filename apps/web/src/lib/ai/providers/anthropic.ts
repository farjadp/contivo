/**
 * Claude adapter — official @anthropic-ai/sdk, shapes from the claude-api skill:
 *  - `maxRetries: 0` (this layer owns retries), per-request `timeout` in ms;
 *  - Opus 5.5 / Sonnet 5.5: no temperature/top_p/top_k and no
 *    `thinking: {type:'disabled'}` (both 400) — thinking is omitted and
 *    `output_config.effort: 'low'` keeps these single-shot tasks cheap;
 *  - structured output via `output_config.format` (never `output_format`),
 *    schema passed through the SDK's transformJSONSchema, which strips what
 *    the API does not support; run.ts re-validates against the original;
 *  - web search = server tool `web_search_20260209`; a `pause_turn` stop is
 *    continued by resending the conversation (capped);
 *  - competitor search (`competitor_web_search`) gets a Claude-only system
 *    instruction and direct (non-code-execution) search, because Claude
 *    otherwise writes homepages from memory and cites nothing — see
 *    docs/evals/2026-11-22-claude-search-citations.md;
 *  - country codes the search tool rejects (IR: 400 "Country code IR is not
 *    supported") are never sent as user_location, and any other such 400 is
 *    retried once without it;
 *  - server-side refusal fallback (`fallbacks: 'default'`, beta
 *    server-side-fallback-2026-07-01), and `stop_reason === 'refusal'` is
 *    checked before reading content.
 */

import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';

import type { AiTokenUsage } from '@/lib/ai-usage';

import { AiProviderError, classifyAnthropic } from '../errors';
import type { AiRequest, AiTask, AiWebSearchResult, ProviderAdapter, ProviderCallInput, ProviderSuccess } from '../types';

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000;
export const MAX_PAUSE_TURNS = 4;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

/** The slice of the SDK client this adapter uses — lets tests pass a fake. */
export interface AnthropicClientLike {
  beta: {
    messages: {
      create(params: CreateParams, options?: { timeout?: number }): Promise<BetaMessage>;
    };
  };
}

const clients = new Map<string, AnthropicClientLike>();

export function defaultAnthropicClient(apiKey: string): AnthropicClientLike {
  let client = clients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey, maxRetries: 0 }) as unknown as AnthropicClientLike;
    clients.set(apiKey, client);
  }
  return client;
}

/**
 * Claude-only instruction for competitor search. Candidates are created from
 * `web_search_result_location` citations only (search.ts), and Claude cites a
 * result only when its text is drawn from that result — live on 22 Nov it
 * searched (9 sources), then wrote each company's homepage from memory and
 * cited nothing. This asks for exactly what the citations-only rule needs:
 * companies taken from results, each line based on the result naming it, and
 * the company's own site looked up rather than a list article's URL.
 */
export const CLAUDE_COMPETITOR_SEARCH_SYSTEM = [
  'You find companies for a competitor list, using web search.',
  'Write one short line per company: its name and its website.',
  'Every line must come from a search result: name only companies that appear in your search results, and base each line on the result where that company appears, so that result is cited.',
  "Prefer a result that is the company's own website. When a company appears only in a list article, review site or directory, search for that company by name and base its line on its own site.",
  'Never add a company, or a website address, from memory. If the results name no companies, say so.',
].join(' ');

/**
 * Searches Claude may run for one competitor query: one broad search plus
 * follow-ups for companies' own sites (an explicit `webSearch.maxUses` wins).
 */
export const COMPETITOR_SEARCH_MAX_USES = 5;

/**
 * Country codes the web search tool rejects with a 400 ("Country code IR is
 * not supported", live 22 Nov). Searches for these markets go out without
 * `user_location`; the query language still carries the market.
 */
export const UNSUPPORTED_SEARCH_COUNTRIES = new Set(['IR']);

const UNSUPPORTED_COUNTRY_MESSAGE = /country code \w+ is not supported/i;

function searchLocation(country: string | undefined) {
  if (!country || UNSUPPORTED_SEARCH_COUNTRIES.has(country.toUpperCase())) return {};
  return { user_location: { type: 'approximate' as const, country } };
}

function isCompetitorSearch(request: AiRequest, task: AiTask | undefined): boolean {
  return task === 'competitor_web_search' && Boolean(request.webSearch) && request.output.kind === 'text';
}

export function buildAnthropicParams(request: AiRequest, model: string, task?: AiTask): CreateParams {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] =
    typeof request.prompt === 'string'
      ? [{ role: 'user', content: request.prompt }]
      : request.prompt.map((turn) => ({ role: turn.role, content: turn.content }));

  // Citations (which web search produces) cannot be combined with
  // output_config.format, so with web search the JSON is validated by us only.
  const format =
    request.output.kind === 'json_schema' && !request.webSearch
      ? { type: 'json_schema' as const, schema: transformJSONSchema(request.output.schema as never) as Record<string, unknown> }
      : undefined;

  const params: CreateParams = {
    model,
    max_tokens: request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages,
    output_config: { effort: 'low', ...(format ? { format } : {}) },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  };
  const competitorSearch = isCompetitorSearch(request, task);
  const system = [request.system, competitorSearch ? CLAUDE_COMPETITOR_SEARCH_SYSTEM : undefined].filter(Boolean).join('\n\n');
  if (system) params.system = system;
  if (request.webSearch) {
    const maxUses = request.webSearch.maxUses ?? (competitorSearch ? COMPETITOR_SEARCH_MAX_USES : undefined);
    params.tools = [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        // Dynamic filtering runs the search inside code execution and passes
        // the model only what its code keeps; citations point into results
        // the model itself read, so competitor search calls it directly.
        ...(competitorSearch ? { allowed_callers: ['direct' as const] } : {}),
        ...(maxUses ? { max_uses: maxUses } : {}),
        ...searchLocation(request.webSearch.country),
      },
    ];
  }
  return params;
}

function addUsage(total: AiTokenUsage, message: BetaMessage): void {
  const usage = message.usage;
  const prompt = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const completion = usage?.output_tokens ?? 0;
  total.promptTokens += prompt;
  total.completionTokens += completion;
  total.totalTokens += prompt + completion;
  total.webSearchCalls = (total.webSearchCalls ?? 0) + (usage?.server_tool_use?.web_search_requests ?? 0);
}

type SearchErrorCode = Anthropic.Beta.Messages.BetaWebSearchToolResultErrorCode;

/**
 * Text, citations and result URLs from Claude content blocks, mapped onto
 * search.ts' {query, citations, sourceUrls}. `.content` of a
 * web_search_tool_result is a list on success and an error OBJECT (HTTP 200)
 * on failure — both are collected.
 */
export function parseAnthropicContent(blocks: BetaContentBlock[]): {
  text: string;
  webSearch: AiWebSearchResult;
  searchErrors: SearchErrorCode[];
} {
  let text = '';
  let query = '';
  const citations: Array<{ url: string; title?: string }> = [];
  const sourceUrls: string[] = [];
  const searchErrors: SearchErrorCode[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      text += block.text;
      for (const citation of block.citations ?? []) {
        if (citation.type === 'web_search_result_location' && citation.url) {
          citations.push({ url: citation.url, title: citation.title ?? undefined });
        }
      }
    } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const q = (block.input as { query?: unknown })?.query;
      if (!query && typeof q === 'string') query = q;
    } else if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const result of block.content) if (result.url) sourceUrls.push(result.url);
      } else {
        searchErrors.push(block.content.error_code);
      }
    }
  }
  return { text, webSearch: { query, citations, sourceUrls }, searchErrors };
}

function searchErrorClass(code: SearchErrorCode): 'rate_limit' | 'server' | 'invalid_output' {
  if (code === 'too_many_requests') return 'rate_limit';
  if (code === 'unavailable') return 'server';
  // max_uses_exceeded / invalid_tool_input / query_too_long / request_too_large:
  // the model's own search went wrong; another try or another model may not.
  return 'invalid_output';
}

/**
 * After a "country code not supported" 400: the same params without
 * `user_location`, or null when the error is anything else.
 */
export function withoutUnsupportedLocation(params: CreateParams, error: unknown): CreateParams | null {
  const status = (error as { status?: unknown })?.status;
  const message = (error as { message?: unknown })?.message;
  if (status !== 400 || typeof message !== 'string' || !UNSUPPORTED_COUNTRY_MESSAGE.test(message)) return null;
  if (!params.tools?.some((tool) => 'user_location' in tool && tool.user_location)) return null;
  const tools = params.tools.map((tool) => {
    if (!('user_location' in tool) || !tool.user_location) return tool;
    const copy = { ...tool };
    delete copy.user_location;
    return copy;
  });
  return { ...params, tools };
}

export function createAnthropicAdapter(
  makeClient: (apiKey: string) => AnthropicClientLike = defaultAnthropicClient,
  now: () => number = Date.now,
): ProviderAdapter {
  return {
    id: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    async call({ task, request, model, apiKey }: ProviderCallInput): Promise<ProviderSuccess> {
      const client = makeClient(apiKey);
      let params = buildAnthropicParams(request, model, task);
      const deadline = now() + request.timeoutMs;
      const usage: AiTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, webSearchCalls: 0 };
      const allBlocks: BetaContentBlock[] = [];
      let message: BetaMessage | null = null;

      for (let turn = 0; turn <= MAX_PAUSE_TURNS; turn += 1) {
        const remaining = deadline - now();
        if (remaining <= 0) {
          throw new AiProviderError({ provider: 'anthropic', errorClass: 'timeout', message: 'attempt deadline passed during pause_turn' });
        }
        try {
          message = await client.beta.messages.create(params, { timeout: remaining });
        } catch (error) {
          // A country code not on our list that the API also rejects: send
          // the search once more without a location instead of failing over.
          const retryParams = withoutUnsupportedLocation(params, error);
          if (!retryParams) throw classifyAnthropic(error);
          params = retryParams;
          try {
            message = await client.beta.messages.create(params, { timeout: Math.max(1, deadline - now()) });
          } catch (retryError) {
            throw classifyAnthropic(retryError);
          }
        }
        addUsage(usage, message);
        allBlocks.push(...message.content);
        if (message.stop_reason !== 'pause_turn') break;
        // Server tool paused a long turn: send the assistant turn back so it continues.
        params.messages = [...params.messages, { role: 'assistant', content: message.content }];
        if (turn === MAX_PAUSE_TURNS) {
          throw new AiProviderError({
            provider: 'anthropic',
            errorClass: 'invalid_output',
            status: 200,
            message: `still pause_turn after ${MAX_PAUSE_TURNS} continuations`,
          });
        }
      }

      if (!message) throw new AiProviderError({ provider: 'anthropic', errorClass: 'invalid_output', message: 'no response' });

      // Refusal is checked before content: after the server-side fallback a
      // refusal means every model in the fallback chain declined.
      if (message.stop_reason === 'refusal') {
        const details = (message as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;
        throw new AiProviderError({
          provider: 'anthropic',
          errorClass: 'refusal',
          status: 200,
          message: `refused${details?.category ? ` (${details.category})` : ''}${details?.explanation ? `: ${details.explanation}` : ''}`,
        });
      }

      const parsed = parseAnthropicContent(allBlocks);
      if (request.webSearch && parsed.searchErrors.length > 0 && parsed.webSearch.sourceUrls.length === 0) {
        const code = parsed.searchErrors[0];
        throw new AiProviderError({
          provider: 'anthropic',
          errorClass: searchErrorClass(code),
          status: 200,
          message: `web_search_tool_result_error: ${code}`,
        });
      }
      if (message.stop_reason === 'max_tokens' && request.output.kind !== 'text') {
        throw new AiProviderError({
          provider: 'anthropic',
          errorClass: 'invalid_output',
          status: 200,
          message: 'stopped at max_tokens before the JSON was complete',
        });
      }

      return {
        model: message.model || model,
        text: parsed.text,
        usage,
        ...(request.webSearch ? { webSearch: parsed.webSearch } : {}),
      };
    },
  };
}

export const anthropicAdapter: ProviderAdapter = createAnthropicAdapter();

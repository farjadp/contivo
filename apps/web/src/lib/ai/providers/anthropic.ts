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
 *  - server-side refusal fallback (`fallbacks: 'default'`, beta
 *    server-side-fallback-2026-07-01), and `stop_reason === 'refusal'` is
 *    checked before reading content.
 */

import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';

import type { AiTokenUsage } from '@/lib/ai-usage';

import { AiProviderError, classifyAnthropic } from '../errors';
import type { AiRequest, AiWebSearchResult, ProviderAdapter, ProviderCallInput, ProviderSuccess } from '../types';

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

export function buildAnthropicParams(request: AiRequest, model: string): CreateParams {
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
  if (request.system) params.system = request.system;
  if (request.webSearch) {
    params.tools = [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        ...(request.webSearch.maxUses ? { max_uses: request.webSearch.maxUses } : {}),
        ...(request.webSearch.country
          ? { user_location: { type: 'approximate' as const, country: request.webSearch.country } }
          : {}),
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

export function createAnthropicAdapter(
  makeClient: (apiKey: string) => AnthropicClientLike = defaultAnthropicClient,
  now: () => number = Date.now,
): ProviderAdapter {
  return {
    id: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    async call({ request, model, apiKey }: ProviderCallInput): Promise<ProviderSuccess> {
      const client = makeClient(apiKey);
      const params = buildAnthropicParams(request, model);
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
          throw classifyAnthropic(error);
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

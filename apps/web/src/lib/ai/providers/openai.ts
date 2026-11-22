/**
 * OpenAI adapter. Reproduces today's requests:
 *  - chat completions (lib/matrices/openai.ts, judge.ts, gemini.ts callOpenAi)
 *    with response_format json_object / json_schema strict;
 *  - Responses API + web_search for search (lib/competitors/search.ts),
 *    with the country hint and `include: web_search_call.action.sources`.
 */

import { parseOpenAiChatUsage, parseOpenAiResponsesUsage, resolveResponseModel } from '@/lib/ai-usage';

import { AiProviderError, classifyOpenAi, classifyThrown } from '../errors';
import type { AiRequest, AiWebSearchResult, ProviderAdapter, ProviderCallInput, ProviderSuccess } from '../types';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_SYSTEM = 'You are precise, factual, and follow output format exactly.';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function chatMessages(request: AiRequest) {
  const turns = typeof request.prompt === 'string' ? [{ role: 'user' as const, content: request.prompt }] : request.prompt;
  return [{ role: 'system' as const, content: request.system || DEFAULT_SYSTEM }, ...turns];
}

function chatBody(request: AiRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages: chatMessages(request) };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_completion_tokens = request.maxTokens;
  if (request.output.kind === 'json_object') body.response_format = { type: 'json_object' };
  if (request.output.kind === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: request.output.name, strict: true, schema: request.output.schema },
    };
  }
  return body;
}

function responsesBody(request: AiRequest, model: string): Record<string, unknown> {
  const country = request.webSearch?.country;
  const body: Record<string, unknown> = {
    model,
    tools: [
      {
        type: 'web_search',
        search_context_size: 'low',
        ...(country ? { user_location: { type: 'approximate', country } } : {}),
      },
    ],
    include: ['web_search_call.action.sources'],
    input: typeof request.prompt === 'string' ? request.prompt : request.prompt,
  };
  if (request.system) body.instructions = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
  if (request.output.kind === 'json_object') body.text = { format: { type: 'json_object' } };
  if (request.output.kind === 'json_schema') {
    body.text = {
      format: { type: 'json_schema', name: request.output.name, strict: true, schema: request.output.schema },
    };
  }
  return body;
}

/** Same extraction as search.ts `extractQueryHarvest`, plus the answer text and refusal. */
export function parseOpenAiResponsesOutput(data: unknown): {
  text: string;
  refusal: string | null;
  webSearch: AiWebSearchResult;
} {
  const output = Array.isArray(asRecord(data)?.output) ? (asRecord(data)!.output as unknown[]) : [];
  const citations: Array<{ url: string; title?: string }> = [];
  const sourceUrls: string[] = [];
  let query = '';
  let text = '';
  let refusal: string | null = null;

  for (const raw of output) {
    const item = asRecord(raw);
    if (!item) continue;
    if (item.type === 'message') {
      for (const rawBlock of Array.isArray(item.content) ? item.content : []) {
        const block = asRecord(rawBlock);
        if (!block) continue;
        if (block.type === 'refusal' && typeof block.refusal === 'string') refusal = block.refusal;
        if (typeof block.text === 'string') text += block.text;
        for (const rawAnnotation of Array.isArray(block.annotations) ? block.annotations : []) {
          const annotation = asRecord(rawAnnotation);
          if (typeof annotation?.url === 'string' && annotation.url) {
            citations.push({
              url: annotation.url,
              title: typeof annotation.title === 'string' ? annotation.title : undefined,
            });
          }
        }
      }
    } else if (item.type === 'web_search_call') {
      const action = asRecord(item.action);
      if (!query && typeof action?.query === 'string') query = action.query;
      for (const rawSource of Array.isArray(action?.sources) ? (action!.sources as unknown[]) : []) {
        const source = asRecord(rawSource);
        if (typeof source?.url === 'string' && source.url) sourceUrls.push(source.url);
      }
    }
  }

  return { text, refusal, webSearch: { query, citations, sourceUrls } };
}

async function post(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw classifyThrown('openai', error);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw classifyOpenAi(res.status, text, res.headers);
  }
  try {
    return await res.json();
  } catch (error) {
    throw new AiProviderError({
      provider: 'openai',
      errorClass: 'invalid_output',
      status: res.status,
      message: `unreadable JSON body: ${(error as Error).message}`,
    });
  }
}

export const openAiAdapter: ProviderAdapter = {
  id: 'openai',
  keyEnv: 'OPENAI_API_KEY',
  async call({ request, model, apiKey }: ProviderCallInput): Promise<ProviderSuccess> {
    if (request.webSearch) {
      const data = await post(RESPONSES_URL, apiKey, responsesBody(request, model), request.timeoutMs);
      const parsed = parseOpenAiResponsesOutput(data);
      if (parsed.refusal) {
        throw new AiProviderError({ provider: 'openai', errorClass: 'refusal', status: 200, message: parsed.refusal });
      }
      return {
        model: resolveResponseModel(data, model),
        text: parsed.text,
        usage: parseOpenAiResponsesUsage(data),
        webSearch: parsed.webSearch,
      };
    }

    const data = await post(CHAT_URL, apiKey, chatBody(request, model), request.timeoutMs);
    const message = asRecord(asRecord((asRecord(data)?.choices as unknown[] | undefined)?.[0])?.message);
    if (typeof message?.refusal === 'string' && message.refusal) {
      throw new AiProviderError({ provider: 'openai', errorClass: 'refusal', status: 200, message: message.refusal });
    }
    return {
      model: resolveResponseModel(data, model),
      text: typeof message?.content === 'string' ? message.content : '',
      usage: parseOpenAiChatUsage(data),
    };
  },
};

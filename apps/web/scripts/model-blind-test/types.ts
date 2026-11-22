import type { AiTokenUsage } from '@/lib/ai-usage';
import type { AiCallContext, AiRequest, AiResult, AiTask } from '@/lib/ai/types';
import type { ContentLanguage } from '@/lib/content-language';
import type { WordCountPlatform } from '@/lib/content-word-count';

/** Everything generateDraftForItem would pass to the draft + humanize steps. */
export interface Brief {
  id: string;
  language: ContentLanguage;
  source: { kind: 'content_item' | 'storyline'; id: string; workspaceId: string; note?: string };
  workspaceName: string;
  brandSummary: unknown;
  topic: string;
  /** What generateDraftForItem passes as "Additional Context/Angle". */
  context: string;
  contextNote: string;
  channel: string;
  frameworkId: string | null;
  selectionReason: string | null;
  wordCount: { platform: WordCountPlatform; min: number; max: number; target: number };
  storylineBlock: string | null;
  storylineClaim: string | null;
}

export type RunAiTask = (task: AiTask, request: AiRequest, ctx?: AiCallContext) => Promise<AiResult>;

export interface CallLog {
  task: AiTask;
  ok: boolean;
  provider: string | null;
  /** The model the provider says answered (OpenAI `model`, Gemini `modelVersion`, Claude `model`). */
  model: string | null;
  usage: AiTokenUsage | null;
  costUsd: number | null;
  latencyMs: number;
  error: string | null;
  failedOver: number;
}

export interface UnitResult {
  briefId: string;
  slot: string;
  provider: string;
  requestedModel: string;
  ok: boolean;
  /** The text a customer would publish (after humanize), normalised identically for every model. */
  text: string | null;
  /** The raw draft before humanize, for the record. */
  draftText: string | null;
  humanizePasses: number;
  error: string | null;
  attempts: number;
  calls: CallLog[];
  resolvedModels: string[];
  promptTokens: number;
  completionTokens: number;
  /** null when any successful call had no verified price. */
  costUsd: number | null;
  latencyMs: number;
  words: number;
  /** Vendor or model names found in the output; such an output would unblind the pack. */
  possibleTells: string[];
}

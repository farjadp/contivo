/**
 * Public API of the AI provider failover layer. Import from '@/lib/ai'.
 * Spec: docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md
 */

export {
  AiUnavailableError,
  createAiRunner,
  getProviderHealthSnapshot,
  getProviderHealthSnapshotHydrated,
  hasHealthyProvider,
  runAiTask,
  runAiTaskOrThrow,
  type AiRunner,
  type AiRunnerDeps,
  type ProviderHealthSnapshot,
} from './run';
export { AiProviderError, sanitizeAiMessage } from './errors';
export { DEFAULT_CHAINS, resolveChain } from './chains';
export {
  AI_TASKS,
  PROVIDER_IDS,
  type AiAttempt,
  type AiCallContext,
  type AiErrorClass,
  type AiFailure,
  type AiMessage,
  type AiOutput,
  type AiRequest,
  type AiResult,
  type AiSuccess,
  type AiTask,
  type AiWebSearchResult,
  type ProviderId,
} from './types';

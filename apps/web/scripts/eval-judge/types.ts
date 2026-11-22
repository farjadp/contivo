/**
 * Shapes shared by the judge calibration eval. The dataset is produced by
 * export-dataset.mjs; see docs/evals/judge-calibration.md.
 */

import type { AiTokenUsage } from '@/lib/ai-usage';

export type Verdict = 'approve' | 'reject';

/** Providers the failover layer can be forced onto (spec: ProviderId). */
export type JudgeProvider = 'openai' | 'anthropic' | 'gemini';

export type Criterion = 'brand_fit' | 'factual_safety' | 'clarity';

export type ReferenceScores = { brandFit: number; factualSafety: number; clarity: number };

export type DatasetItem = {
  id: string;
  synthetic: boolean;
  source: 'local_db_gate_verdict' | 'local_db_known_fabrication' | 'hand_written';
  contentItemId: string | null;
  runId: string | null;
  workspaceId: string | null;
  channel: string;
  language: 'en' | 'fa';
  topic: string;
  content: string;
  brandSummary: unknown;
  storyline: null;
  reference: {
    verdict: Verdict;
    labelSource: 'gate_verdict' | 'gate_prompt_rule' | 'hand_written';
    rejectedBy: string | null;
    scores: ReferenceScores | null;
    judgeProvider: string | null;
    judgeModel: string | null;
    judgeModelAssumed: string | null;
    judgedAt: string | null;
    promptCommitAtJudgment: string | null;
    promptNote: string | null;
  };
  expected: { verdict: Verdict; fabrication: boolean; failingCriterion: Criterion | null };
  why?: string;
  caveats: string[];
};

export type Dataset = {
  builtAt: string;
  census: Record<string, number>;
  counts: Record<string, number>;
  items: DatasetItem[];
};

export type JudgeRequest = { system: string; prompt: string; timeoutMs: number };

export type JudgeCall =
  | {
      ok: true;
      provider: string;
      model: string;
      text: string;
      /** Parsed by the provider layer when it already did; else null. */
      json: unknown | null;
      usage: AiTokenUsage | null;
      latencyMs: number;
    }
  | { ok: false; error: string; latencyMs: number };

export interface JudgeTransport {
  /** What the run is forced onto. A call answered by anything else is an error. */
  readonly provider: JudgeProvider | 'fixture';
  call(request: JudgeRequest): Promise<JudgeCall>;
}

export type JudgeOutcome = {
  approved: boolean;
  verdict: Verdict;
  scores: ReferenceScores;
  /** Criteria under the gate threshold. */
  below: Criterion[];
  vetoed: boolean;
  notes: string[];
};

export type ItemResult = {
  itemId: string;
  repeat: number;
  synthetic: boolean;
  fabrication: boolean;
  expectedVerdict: Verdict;
  /** null when the call failed or the reply was unusable — counted as a disagreement. */
  outcome: JudgeOutcome | null;
  error: string | null;
  provider: string | null;
  model: string | null;
  usage: AiTokenUsage | null;
  costUsd: number | null;
  latencyMs: number;
};

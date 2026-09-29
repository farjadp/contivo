# Positioning Matrices Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous, fabricating matrices generator with an evidence-backed background run: 2 core + 1–3 market charts, scores that cite evidence, a white-space finding and content angles per chart, and manual corrections that survive regeneration.

**Architecture:** Same shape as competitor discovery: a server action creates a `MatrixRun` and dispatches `/api/matrices/run`, which runs a staged pipeline in `after()` and writes rows in four new tables. A projection builder (already written, `lib/matrices/projection.ts`) turns the latest run plus the override layer into the `audienceInsights.competitiveMatrices` blob every existing reader consumes, so downstream code keeps working. Every model call uses structured outputs; any failure fails the whole run and writes nothing.

**Tech Stack:** Next.js 15 (App Router, server actions, `after()`), Prisma 5.22 on Postgres (Neon, schema `contivo`), OpenAI chat completions with `json_schema`, next-intl (en, fa), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-26-positioning-matrices-design.md` (approved 29 Sep 2026). Read it before any task.

## Global Constraints

- Work only in the worktree `/Users/farjad/Downloads/Work-Studio/Contivo/.claude/worktrees/matrices-rebuild`, branch `matrices-rebuild`. **Never run `next build` in the primary checkout** (it breaks the running dev server). `pnpm build` inside this worktree is fine.
- Fail closed (M3): no heuristic, hash-based or default score is ever written. A failed run leaves every table and the projection untouched.
- Certainty is the enum `certain | likely | unsure`, mapped in code by `finalConfidence` (M9). The model never emits a number for confidence.
- Output language = `Workspace.contentLanguage` (`FA` → `fa`, otherwise `en`) (M7). Core axis labels come from the message files, never from the model.
- Schema ships as a migration file under `apps/api/prisma/migrations/` (M11). Never `db push` against production. The discovery partial index `discovery_runs_one_active_per_workspace` must not be dropped by anything generated.
- Model: `process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1'`. Token counts: `null` means unknown, never 0 (same rule as discovery).
- Minimum 3 charts (2 core + ≥1 market); `REQUIRED_MATRIX_CHARTS = 3` everywhere the old 5 was used, including the Nest API.
- Copy in en and fa. Persian written as Persian, not translated calques; digits through `useFormatter`. `node scripts/check-i18n.mjs` must pass.
- Commit messages: plain sentences, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git commit -F -` with a quoted heredoc (backticks in `-m "..."` execute).
- Verification per task: `cd apps/web && VITE_CONFIG_NATIVE_IGNORE_WARNING=true pnpm test`, `pnpm typecheck`, `pnpm lint` all clean before commit.

## Deviations from the spec (decided while planning, 29 Sep)

1. **Pausing for axes is a status, not a stage.** When the workspace has no `matrixAxes`, the run proposes 4 candidates, stores them on the run (`axisCandidates`) and ends with status `NEEDS_AXES`. That status is not "active", so it neither holds the one-active-run index nor gets reaped. The user's pick is saved to `Workspace.matrixAxes` by `saveMatrixAxes`, which starts a fresh run. Reason: a run that sleeps waiting for a human would hold the index and be killed by the 10-minute reaper.
2. **`MatrixRun` gains `axisCandidates Json?` and `status` gains `NEEDS_AXES`.**
3. **"Core charts agree"** (spec §5.3) is defined as: the company's (x-third, y-third) cell is the same on both core charts, using `axisThird`.
4. **Token usage in the UI** comes from the run (`tokensUsed`), not from `token_usage` in the blob; the projection carries `tokens_used` for the page's cost line.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/api/prisma/schema.prisma` | four models + `Workspace.matrixAxes` + relations |
| `apps/api/prisma/migrations/20260929000000_positioning_matrices/migration.sql` | DDL + partial unique index for one active run |
| `apps/web/src/lib/run-with-concurrency.ts` | shared bounded-parallel helper |
| `apps/web/src/lib/matrices/axes.ts` | core axis definitions, label lookup from messages, market-axis normaliser |
| `apps/web/src/lib/matrices/bundle.ts` | deterministic evidence bundle per company |
| `apps/web/src/lib/matrices/openai.ts` | one structured-output call, throws `MatrixAiError` |
| `apps/web/src/lib/matrices/propose-axes.ts` | market-axis candidates prompt + schema |
| `apps/web/src/lib/matrices/score-chart.ts` | per-chart scoring prompt, schema, validation, confidence |
| `apps/web/src/lib/matrices/summarise.ts` | per-chart and cross-chart summaries |
| `apps/web/src/lib/matrices/persist.ts` | load latest run + overrides, build and write the projection |
| `apps/web/src/lib/matrices/pipeline.ts` | `runMatrixPipeline`, `reapStaleMatrixRuns`, stages |
| `apps/web/src/app/api/matrices/run/route.ts` | authenticated background entry |
| `apps/web/src/app/actions/growth-matrices.ts` | rewritten: start, status, save axes, overrides |
| `.../growth/[id]/_components/matrices/*` | the rebuilt matrix half of the tab |

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add models after `DiscoveryRun`, add fields to `Workspace`)
- Create: `apps/api/prisma/migrations/20260929000000_positioning_matrices/migration.sql`

**Interfaces:**
- Produces: Prisma delegates `prisma.matrixRun`, `prisma.matrixChart`, `prisma.matrixScore`, `prisma.matrixOverride`; `Workspace.matrixAxes Json?`.

- [ ] **Step 1: Add the models** (verbatim from spec §4 with the deviations):

```prisma
model MatrixRun {
  id             String        @id @default(cuid())
  workspaceId    String
  userId         String
  status         String // PENDING | RUNNING | NEEDS_AXES | DONE | FAILED
  stage          String? // AXES | SCORE | SUMMARISE | SAVE
  basis          String // ACCEPTED | UNCONFIRMED_HIGH
  language       String // "fa" | "en"
  competitorSet  Json // [{ competitorId, domain, type }]
  axesUsed       Json? // [{ key, kind, x, y }]
  axisCandidates Json? // [{ key, x, y, rationale }] when status = NEEDS_AXES
  crossChart     Json? // { crossChartSummary, strongestDifferentiation, targetAudienceSegment }
  tokensUsed     Int           @default(0)
  error          String?
  startedAt      DateTime      @default(now())
  finishedAt     DateTime?
  workspace      Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  charts         MatrixChart[]

  // A partial unique index (one PENDING/RUNNING run per workspace) exists in
  // the migration and cannot be expressed here. Remove any DROP INDEX for
  // matrix_runs_one_active_per_workspace that a generated migration proposes.
  @@index([workspaceId, startedAt])
  @@map("matrix_runs")
}

model MatrixChart {
  id            String        @id @default(cuid())
  runId         String
  workspaceId   String
  key           String
  kind          String // CORE | MARKET
  order         Int
  name          String
  xLabel        String
  yLabel        String
  marketPattern String
  opportunity   String
  contentAngles Json // [{ angle, audienceSegment }] max 3
  whiteSpace    Json? // { xBand, yBand, nearestCompetitorDistance } or null
  run           MatrixRun     @relation(fields: [runId], references: [id], onDelete: Cascade)
  scores        MatrixScore[]

  @@index([workspaceId, key])
  @@map("matrix_charts")
}

model MatrixScore {
  id           String      @id @default(cuid())
  chartId      String
  competitorId String? // null = TARGET
  name         String
  domain       String
  type         String // TARGET | DIRECT | INDIRECT | ASPIRATIONAL
  xScore       Int
  yScore       Int
  xReason      String
  yReason      String
  evidenceRefs Json // string[]
  confidence   Float
  estimated    Boolean     @default(false)
  chart        MatrixChart @relation(fields: [chartId], references: [id], onDelete: Cascade)

  @@map("matrix_scores")
}

model MatrixOverride {
  id           String    @id @default(cuid())
  workspaceId  String
  chartKey     String
  competitorId String? // null = TARGET
  xScore       Int?
  yScore       Int?
  note         String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, chartKey, competitorId])
  @@map("matrix_overrides")
}
```

In `model Workspace` add `matrixAxes Json?`, `matrixRuns MatrixRun[]`, `matrixOverrides MatrixOverride[]`.

Note: Postgres treats NULLs as distinct in a unique constraint, so `@@unique([workspaceId, chartKey, competitorId])` does not stop two TARGET overrides. The migration adds `NULLS NOT DISTINCT` (Postgres 15+, Neon runs 16). Verify with `select version()` locally; if the local server is < 15, stop and report.

- [ ] **Step 2: Generate the DDL against a throwaway shadow database**, the way `20260927000000_competitor_discovery` was made:

```bash
cd apps/api
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://postgres:postgres@localhost:5433/contivo_shadow_matrices?schema=contivo" --script > /tmp/matrices.sql
```

Create the shadow database first (`createdb -h localhost -p 5433 -U postgres contivo_shadow_matrices`, drop it after). Copy the output into `migration.sql`. **Remove any line touching `discovery_runs_one_active_per_workspace`.** Then append by hand:

```sql
-- One PENDING/RUNNING matrix run per workspace (schema.prisma cannot express it).
CREATE UNIQUE INDEX IF NOT EXISTS "matrix_runs_one_active_per_workspace"
ON "matrix_runs" ("workspaceId")
WHERE "status" IN ('PENDING', 'RUNNING');

-- A TARGET override has competitorId NULL; NULLs must collide here.
DROP INDEX IF EXISTS "matrix_overrides_workspaceId_chartKey_competitorId_key";
CREATE UNIQUE INDEX "matrix_overrides_workspaceId_chartKey_competitorId_key"
ON "matrix_overrides" ("workspaceId", "chartKey", "competitorId") NULLS NOT DISTINCT;
```

- [ ] **Step 3: Apply locally and regenerate the client**

```bash
cd apps/api && DATABASE_URL="$(grep -E '^DATABASE_URL=' ../web/.env.local | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy && npx prisma generate
```

The worktree has no `.env.local`; read it from `/Users/farjad/Downloads/Work-Studio/Contivo/apps/web/.env.local`. The local DB was built with `db push`: if `migrate deploy` reports drift or a failed migration, stop and report instead of resetting anything. Expected: `Applying migration 20260929000000_positioning_matrices`.

- [ ] **Step 4: Verify the indexes exist**

```bash
psql "<local url without ?schema>" -c "select indexname from pg_indexes where schemaname='contivo' and tablename in ('matrix_runs','matrix_overrides','discovery_runs');"
```

Expected: both matrix indexes and `discovery_runs_one_active_per_workspace` present.

- [ ] **Step 5: Commit** schema + migration.

---

### Task 2: Shared concurrency helper and core axes

**Files:**
- Create: `apps/web/src/lib/run-with-concurrency.ts`, `apps/web/src/lib/run-with-concurrency.test.ts`
- Create: `apps/web/src/lib/matrices/axes.ts`, `apps/web/src/lib/matrices/axes.test.ts`
- Modify: `apps/web/messages/en/tabs-b.json`, `apps/web/messages/fa/tabs-b.json` (add `tabsB.matrices.coreAxes`)

**Interfaces:**
- Produces:
  - `runWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]>` — results in input order; rejects with the first error after in-flight tasks settle.
  - `type MatrixLanguage = 'fa' | 'en'`; `languageFromContent(contentLanguage: string | null | undefined): MatrixLanguage` (`'FA'` → `'fa'`, else `'en'`).
  - `type AxisDefinition = { key: string; kind: ChartKind; name: string; x: { label: string; low: string; high: string }; y: { label: string; low: string; high: string } }`.
  - `CORE_AXIS_KEYS = ['offer_breadth_specialization', 'content_presence_focus'] as const`.
  - `coreAxes(language: MatrixLanguage): AxisDefinition[]` — labels read from the message JSON files (static import of `messages/{en,fa}/tabs-b.json`).
  - `type StoredMarketAxis = { key: string; x: { label: string; low: string; high: string }; y: { label: string; low: string; high: string }; rationale: string }`.
  - `parseStoredMarketAxes(value: unknown): StoredMarketAxis[]` — drops malformed entries, keeps at most 3, slugifies `key` (`[a-z0-9_]`, max 60), rejects a key equal to a core key.
  - `axesForRun(language: MatrixLanguage, market: StoredMarketAxis[]): AxisDefinition[]` — core first (order 0, 1), then market with `kind: 'MARKET'`, `name: \`${x.label} / ${y.label}\``.

- [ ] **Step 1: Messages.** Under `tabsB.matrices` add, in en:

```json
"coreAxes": {
  "offer_breadth_specialization": {
    "name": "Offer breadth and specialisation",
    "x": { "label": "Breadth of offer", "low": "One thing", "high": "Full suite" },
    "y": { "label": "Specialisation", "low": "Generalist", "high": "Niche expert" }
  },
  "content_presence_focus": {
    "name": "Content presence and focus",
    "x": { "label": "Content presence", "low": "Almost none", "high": "Publishing machine" },
    "y": { "label": "Content focus", "low": "Scattered topics", "high": "Tightly themed" }
  }
}
```

and in fa:

```json
"coreAxes": {
  "offer_breadth_specialization": {
    "name": "گستره و تخصص پیشنهاد",
    "x": { "label": "گسترهٔ پیشنهاد", "low": "فقط یک چیز", "high": "مجموعهٔ کامل" },
    "y": { "label": "تخصص", "low": "همه‌کاره", "high": "متخصص یک حوزه" }
  },
  "content_presence_focus": {
    "name": "حضور و تمرکز محتوایی",
    "x": { "label": "حضور محتوایی", "low": "تقریباً هیچ", "high": "پرکار و مداوم" },
    "y": { "label": "تمرکز محتوا", "low": "موضوع‌های پراکنده", "high": "یک موضوع روشن" }
  }
}
```

- [ ] **Step 2: Failing tests** (`axes.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { axesForRun, coreAxes, languageFromContent, parseStoredMarketAxes } from './axes';

const market = {
  key: 'Compliance Depth!',
  x: { label: 'Compliance depth', low: 'Basic', high: 'Audit-ready' },
  y: { label: 'Ease of use', low: 'Expert tool', high: 'Anyone can use it' },
  rationale: 'Buyers compare on both.',
};

describe('axes', () => {
  it('maps content language', () => {
    expect(languageFromContent('FA')).toBe('fa');
    expect(languageFromContent('EN')).toBe('en');
    expect(languageFromContent(null)).toBe('en');
  });

  it('reads core labels from the messages, per language', () => {
    expect(coreAxes('en').map((a) => a.key)).toEqual(['offer_breadth_specialization', 'content_presence_focus']);
    expect(coreAxes('fa')[0].x.label).toBe('گسترهٔ پیشنهاد');
    expect(coreAxes('en').every((a) => a.kind === 'CORE')).toBe(true);
  });

  it('slugifies, caps at three and refuses a core key', () => {
    const parsed = parseStoredMarketAxes([market, market, market, market, { ...market, key: 'content_presence_focus' }, { nope: 1 }]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].key).toBe('compliance_depth');
  });

  it('puts core first, then market', () => {
    const axes = axesForRun('en', parseStoredMarketAxes([market]));
    expect(axes.map((a) => a.kind)).toEqual(['CORE', 'CORE', 'MARKET']);
    expect(axes[2].name).toBe('Compliance depth / Ease of use');
  });
});
```

Plus `run-with-concurrency.test.ts`: order preserved with concurrency 2 over 5 items with random delays; never more than 2 in flight (track a counter); rejects when one task throws.

- [ ] **Step 3: Implement** both files. `axes.ts` imports `en from '../../../messages/en/tabs-b.json'` and `fa from '../../../messages/fa/tabs-b.json'` (check `resolveJsonModule` in `apps/web/tsconfig.json`; it is on for Next apps). If two market axes slugify to the same key, suffix `_2`, `_3`.
- [ ] **Step 4: Run tests, typecheck, i18n check.** Expected PASS.
- [ ] **Step 5: Commit.**

---

### Task 3: Evidence bundle

**Files:**
- Create: `apps/web/src/lib/matrices/bundle.ts`, `apps/web/src/lib/matrices/bundle.test.ts`

**Interfaces:**
- Consumes: `parseStoredEvidence(value: unknown): EvidenceItem[]` from `@/lib/competitors/pipeline`; `EvidenceItem` from `@/lib/competitors/types`.
- Produces:

```ts
export type BundleEvidence = { id: string; kind: string; text: string };
export type BundleCompany = {
  companyId: string;            // competitor id, or 'TARGET'
  competitorId: string | null;  // null for the target
  name: string;
  domain: string;
  type: CompanyType;
  positioning: string | null;
  keyFeatures: string[];
  labels: string[];
  keywordThemes: string[];      // from competitorKeywordsIntel, [] when absent or empty
  evidence: BundleEvidence[];
};
export type EvidenceBundle = { target: BundleCompany; competitors: BundleCompany[] };
export function buildEvidenceBundle(input: {
  workspace: { name: string; websiteUrl: string | null; brandSummary: unknown; audienceInsights: unknown };
  competitors: Array<{ id: string; name: string; domain: string | null; type: string | null; positioning: string | null; keyFeatures: string[]; labels: string[]; evidence: unknown }>;
}): EvidenceBundle;
export function hasBrandSummary(brandSummary: unknown): boolean;
export function evidenceIdsFor(bundle: EvidenceBundle, companyId: string): Set<string>;
```

Rules:
- Competitor evidence text = `[title, snippet].filter(Boolean).join(' — ')`, max 300 chars; items with no text dropped; max 12 items per company.
- Target evidence from `brandSummary`: every non-empty string field and every string in array fields, each becoming `{ id: 'own:<field>[:<index>]', kind: 'own', text }`, max 12. `hasBrandSummary` is true when at least one such item exists.
- `keywordThemes`: from `audienceInsights.competitorKeywordsIntel.competitors[]` matched by normalised domain (lower-case, strip `www.` and protocol), taking `primary_keywords` then `keyword_clusters[].cluster`, max 10. Ignore entries with both keyword lists empty.
- Target domain from `websiteUrl`, normalised the same way. Unknown competitor `type` → `DIRECT`.

- [ ] **Step 1: Failing tests** covering: evidence ids preserved from stored items; a competitor with `evidence: null` gets `[]`; target ids prefixed `own:`; keyword themes matched by domain with `www.`; empty keyword entry ignored; `hasBrandSummary(null)` false, `hasBrandSummary({ offers: ['A'] })` true; `evidenceIdsFor` returns the right set.
- [ ] **Step 2: Implement.** **Step 3: tests pass.** **Step 4: Commit.**

---

### Task 4: Structured OpenAI call

**Files:**
- Create: `apps/web/src/lib/matrices/openai.ts`, `apps/web/src/lib/matrices/openai.test.ts`

**Interfaces:**
- Consumes: `readTokenUsage(data: unknown): number | null` from `@/lib/competitors/queries`.
- Produces:

```ts
export class MatrixAiError extends Error {}
export const MATRIX_REQUEST_TIMEOUT_MS = 90_000;
export async function callStructured<T>(args: {
  name: string;                       // json_schema name
  schema: Record<string, unknown>;    // strict JSON schema
  system: string;
  user: string;
}): Promise<{ data: T; tokens: number | null }>;
```

Behaviour: throws `MatrixAiError` when `OPENAI_API_KEY` is missing (message `OPENAI_API_KEY is not set`), on non-2xx (message includes status, never the key), on network/timeout, on missing content, on JSON parse failure. On a parse failure after a 200, the error carries `tokens` (add `readonly tokens: number | null` to `MatrixAiError`) so the pipeline can still count spend. Request: `POST https://api.openai.com/v1/chat/completions`, `temperature: 0.2`, `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`, `signal: AbortSignal.timeout(MATRIX_REQUEST_TIMEOUT_MS)`.

- [ ] **Step 1: Failing tests** with `vi.stubGlobal('fetch', ...)`: success returns parsed data and tokens 150; 429 throws `MatrixAiError` with `429` in the message; invalid JSON throws with `tokens === 150`; missing key throws before calling fetch; request body uses `json_schema` with `strict: true`.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit.**

---

### Task 5: Market-axis proposals

**Files:**
- Create: `apps/web/src/lib/matrices/propose-axes.ts`, `apps/web/src/lib/matrices/propose-axes.test.ts`

**Interfaces:**
- Consumes: `callStructured`, `EvidenceBundle`, `MatrixLanguage`, `StoredMarketAxis`, `parseStoredMarketAxes`, `CORE_AXIS_KEYS`.
- Produces: `proposeMarketAxes(bundle: EvidenceBundle, language: MatrixLanguage, brief: { brandName: string; targetCountry: string | null }): Promise<{ candidates: StoredMarketAxis[]; tokens: number | null }>` — exactly 4 candidates or throws `MatrixAiError('axis proposal returned fewer than 2 usable candidates')` when fewer than 2 survive normalisation (keep up to 4).
- Also exported for tests: `AXIS_SCHEMA`, `buildAxisPrompt(...)`.

Schema: `{ candidates: [{ key, x: { label, low, high }, y: { label, low, high }, rationale, evidence_fields: string[] }] }`, `minItems 4, maxItems 4`, all strings required, `additionalProperties: false` everywhere.

Prompt rules (from spec §3.2): both ends observable in the bundle; no duplicate of the two core axes (state them); no "strategy", "creativity", "execution" style abstractions; labels ≤ 40 chars; written in `language`; rationale one sentence. Include each company's name, positioning, key features, labels and up to 5 evidence texts; the target's brand summary items.

- [ ] **Step 1: Failing tests** (mock `callStructured` via `vi.mock('./openai')`): 4 good candidates → 4 returned, keys slugified; a candidate whose key is a core key is dropped; only 1 usable → throws `MatrixAiError`; prompt contains the language instruction for fa ("Write every label in Persian") and both core axis labels.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit.**

---

### Task 6: Scoring one chart

**Files:**
- Create: `apps/web/src/lib/matrices/score-chart.ts`, `apps/web/src/lib/matrices/score-chart.test.ts`

**Interfaces:**
- Consumes: `callStructured`, `EvidenceBundle`, `evidenceIdsFor`, `AxisDefinition`, `normalizeCertainty`, `finalConfidence`, `isEstimated`, `axisThird` from `./scoring`, `MatrixScore` from `./types`.
- Produces:

```ts
export type ScoredCompany = MatrixScore & { xReason: string; yReason: string; evidenceRefs: string[]; certainty: Certainty };
export async function scoreChart(bundle: EvidenceBundle, axis: AxisDefinition, language: MatrixLanguage): Promise<{ scores: ScoredCompany[]; tokens: number | null }>;
export function applyCoreAgreement(coreA: ScoredCompany[], coreB: ScoredCompany[]): [ScoredCompany[], ScoredCompany[]];
export const REASON_MAX_CHARS = 200;
```

Schema: `{ companies: [{ company_id, x_score (integer 1..10), y_score (integer 1..10), x_reason, y_reason, evidence_refs: string[], certainty: enum ['certain','likely','unsure'] }] }`, strict.

Validation in code (throw `MatrixAiError` on the first two):
1. Every bundle company (target + competitors) must appear exactly once by `company_id`; a missing or unknown id fails the chart.
2. Scores outside 1..10 or non-integers fail the chart (schema should prevent this; enforce anyway).
3. `evidence_refs` filtered to `evidenceIdsFor(bundle, companyId)`; unknown ids dropped silently.
4. `estimated = isEstimated(refs.length)`; `confidence = finalConfidence({ certainty, evidenceCount: refs.length })` (agreement applied later).
5. Reasons trimmed to `REASON_MAX_CHARS`.

`applyCoreAgreement` recomputes `confidence` with `coreChartsAgree: true` for companies whose `(axisThird(x), axisThird(y))` match across the two core charts, leaving everyone else unchanged.

Prompt: axis definition with the low/high meaning of each end as the rubric; the target's scale stated explicitly ("Score the target from its own evidence; do not default it to the middle"); `certainty` meaning; "cite evidence ids exactly as given; cite nothing rather than invent"; reasons in `language`, ≤ 200 chars, never containing "estimated" or "inferred" when citing evidence.

- [ ] **Step 1: Failing tests:** happy path maps certainty to 0.9/0.7/0.5 floors and marks `estimated` when refs empty (confidence ≤ 0.5); unknown evidence id dropped; missing company throws; `company_id: 'TARGET'` maps to `competitorId: null`, `type: 'TARGET'`; `applyCoreAgreement` raises confidence only for agreeing companies and never above the next certainty floor.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit.**

---

### Task 7: Summaries

**Files:**
- Create: `apps/web/src/lib/matrices/summarise.ts`, `apps/web/src/lib/matrices/summarise.test.ts`

**Interfaces:**
- Consumes: `callStructured`, `findWhiteSpace`, `describeBand`, `WhiteSpace`, `ScoredCompany`, `AxisDefinition`.
- Produces:

```ts
export type ChartSummary = { marketPattern: string; opportunity: string; contentAngles: Array<{ angle: string; audienceSegment: string }> };
export async function summariseChart(axis: AxisDefinition, scores: ScoredCompany[], whiteSpace: WhiteSpace | null, language: MatrixLanguage): Promise<{ summary: ChartSummary; tokens: number | null }>;
export type CrossChartSummary = { crossChartSummary: string; strongestDifferentiation: string; targetAudienceSegment: string };
export async function summariseAcrossCharts(charts: Array<{ axis: AxisDefinition; summary: ChartSummary }>, language: MatrixLanguage): Promise<{ summary: CrossChartSummary; tokens: number | null }>;
export function describeWhiteSpace(axis: AxisDefinition, whiteSpace: WhiteSpace | null): string | null;
```

`describeWhiteSpace` returns e.g. `"Breadth of offer: One thing–side; Specialisation: Niche expert–side"` using `describeBand(band, low, high)`, or `null`. The chart prompt includes it and requires `opportunity` to name that cell in words; when `null`, it requires `opportunity` to say plainly that no clear gap exists near the target. `content_angles` schema `maxItems: 3`, each `{ angle, audience_segment }`; empty strings are dropped in code. A chart summary with an empty `marketPattern` or `opportunity` throws `MatrixAiError`.

- [ ] **Step 1: Failing tests:** prompt contains the white-space description; null white space puts the "no clear gap" instruction in the prompt; more than 3 angles are cut to 3; empty `opportunity` throws; cross-chart returns the three fields.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit.**

---

### Task 8: Projection persistence

**Files:**
- Modify: `apps/web/src/lib/matrices/projection.ts` (add `tokens_used: number` to `Projection` and `tokensUsed: number` to `ProjectionInput`; update its test)
- Create: `apps/web/src/lib/matrices/persist.ts`, `apps/web/src/lib/matrices/persist.test.ts`

**Interfaces:**
- Consumes: `buildProjection`, `prisma`, `selectCompetitors`.
- Produces:

```ts
export async function rebuildMatricesProjection(workspaceId: string): Promise<Projection | null>;
```

Behaviour: loads the latest `DONE` run for the workspace (with charts ordered by `order`, scores), all overrides, and the workspace's competitors. `liveCompetitorIds` = ids of `selectCompetitors(competitors).competitors`; `runCompetitorIds` = ids in `run.competitorSet`. Builds the projection (chart `name` from the row, cross-chart fields from `run.crossChart`) and writes it to `audienceInsights.competitiveMatrices` with a read-modify-write that keeps every other key. Returns `null` and writes nothing when there is no DONE run (a workspace with only a legacy blob keeps its legacy blob).

- [ ] **Step 1: Failing tests** (prisma mocked): no DONE run → returns null, no update; DONE run + one override on the target → written blob has the override applied and `override.ai_x_score` set; other `audienceInsights` keys survive; an override for a deleted competitor is ignored; a competitor accepted after the run → `stale: true`.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit.**

---

### Task 9: Pipeline and route

**Files:**
- Create: `apps/web/src/lib/matrices/pipeline.ts`, `apps/web/src/lib/matrices/pipeline.test.ts`
- Create: `apps/web/src/app/api/matrices/run/route.ts`, `apps/web/src/app/api/matrices/run/route.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8; `runWithConcurrency`; `writeActivityLog`; `sanitizeUpstreamText` (find its export with `grep -rn "export function sanitizeUpstreamText" apps/web/src`); `isStaleRun` from `@/lib/competitors/pipeline`.
- Produces:

```ts
export const MATRIX_STALE_RUN_MINUTES = 10;
export const MATRIX_STAGES = ['AXES', 'SCORE', 'SUMMARISE', 'SAVE'] as const;
export const SCORE_CONCURRENCY = 3;
export async function runMatrixPipeline(runId: string): Promise<void>;   // never throws
export async function reapStaleMatrixRuns(workspaceId: string): Promise<void>;
```

Flow (mirror `runDiscoveryPipeline`; guarded writes via `updateMany({ where: { id, status: 'RUNNING' } })` and a local `RunNoLongerActiveError`):
1. Load run with workspace + competitors. Claim `PENDING → RUNNING`; if count 0, return.
2. Rebuild the competitor list from `run.competitorSet` ids (skip ids that no longer exist; fewer than 2 left → fail `not enough competitors`). Build the bundle. No brand summary → fail.
3. Stage `AXES`: `parseStoredMarketAxes(workspace.matrixAxes)`. If empty: `proposeMarketAxes`, then in one guarded update set `status: 'NEEDS_AXES'`, `axisCandidates`, `tokensUsed`, `finishedAt`; activity log `MATRICES_AXES_PROPOSED`; return.
4. Stage `SCORE`: `axesForRun(language, market)`; `runWithConcurrency(axes, SCORE_CONCURRENCY, scoreChart)`; then `applyCoreAgreement` on the two core charts. Any chart failure fails the run.
5. Stage `SUMMARISE`: per chart `findWhiteSpace(scores)` then `summariseChart` (concurrency 3), then `summariseAcrossCharts`.
6. Stage `SAVE`: `prisma.$transaction`: guarded update of the run to `DONE` with `axesUsed`, `crossChart`, `tokensUsed`, `finishedAt` (throws `RunNoLongerActiveError` on count 0), then create charts with nested scores. After the transaction: `rebuildMatricesProjection(workspaceId)`; activity log `MATRICES_GENERATED` with `{ runId, charts, tokens }`.
7. On any other error: guarded update (`status in PENDING|RUNNING`) to `FAILED` with `sanitizeUpstreamText(message)`, `tokensUsed` so far, `finishedAt`; activity log `MATRICES_RUN_FAILED`. Nothing else is written, and the projection is not touched.

Tokens: sum every call's `tokens` and every `MatrixAiError.tokens`; if any call's count was `null`, still store the sum of the known ones.

Route: copy `apps/web/src/app/api/growth/discovery/run/route.ts` exactly (runtime nodejs, dynamic force-dynamic, `maxDuration = 300`, bearer check with `timingSafeEqual`, 503/401/400/202), calling `runMatrixPipeline(runId)` in `after()`.

- [ ] **Step 1: Failing pipeline tests** (mock prisma with `$transaction: fn => fn(prismaMock)`, mock `./propose-axes`, `./score-chart`, `./summarise`, `./persist`):
  - no `matrixAxes` → status `NEEDS_AXES` with 4 candidates, no charts created, projection not rebuilt;
  - with axes → charts created in order, run `DONE`, `rebuildMatricesProjection` called once, tokens summed;
  - one `scoreChart` rejects → run `FAILED`, no `matrixChart.create`, no projection rebuild;
  - claim lost (count 0) → returns without any other write;
  - `reapStaleMatrixRuns` marks only runs older than 10 minutes and never touches `NEEDS_AXES`.
- [ ] **Step 2: Failing route tests:** copy `apps/web/src/app/api/growth/discovery/run/route.test.ts` and adapt.
- [ ] **Step 3: Implement. Step 4: pass. Step 5: Commit.**

---

### Task 10: Server actions (replace the old generator)

**Files:**
- Rewrite: `apps/web/src/app/actions/growth-matrices.ts`
- Create: `apps/web/src/app/actions/growth-matrices.test.ts`
- Modify: `apps/web/src/app/actions/competitor-basis-edits.test.ts` (delete the matrices `describe`; keep the offerings one)
- Modify: `apps/web/messages/{en,fa}/errors.json`

**Interfaces:**
- Produces (all `'use server'`):

```ts
export type MatrixRunView = {
  id: string; status: 'PENDING' | 'RUNNING' | 'NEEDS_AXES' | 'DONE' | 'FAILED';
  stage: string | null; tokensUsed: number; errorKind: 'timedOut' | 'dispatch' | 'generic' | null;
  axisCandidates: StoredMarketAxis[]; startedAt: string; finishedAt: string | null;
};
export type MatrixStatus = { run: MatrixRunView | null; savedAxes: StoredMarketAxis[]; basis: SelectionBasis; competitorCount: number; hasBrandSummary: boolean; matrices: unknown };
export async function startMatrixRun(workspaceId: string): Promise<{ runId: string } | { error: string }>;
export async function getMatrixStatus(workspaceId: string): Promise<MatrixStatus | { error: string }>;
export async function saveMatrixAxes(workspaceId: string, axes: StoredMarketAxis[]): Promise<{ runId: string } | { error: string }>;
export async function setMatrixOverride(workspaceId: string, chartKey: string, competitorId: string | null, patch: { xScore?: number | null; yScore?: number | null; note?: string | null }): Promise<{ matrices: unknown } | { error: string }>;
export async function clearMatrixOverride(workspaceId: string, chartKey: string, competitorId: string | null): Promise<{ matrices: unknown } | { error: string }>;
```

Rules:
- Every action: `getSession`, then ownership with `prisma.workspace.findFirst({ where: { id, userId } })`; not found and not yours return the same `workspaceNotFound`.
- `startMatrixRun`: `reapStaleMatrixRuns`; refuse `matrixAlreadyRunning` if a PENDING/RUNNING run exists; `selectCompetitors` → `basis === 'NONE'` or fewer than 2 → `needTwoReviewedMatrices`; no brand summary → `matrixNeedsBrandSummary`; create run `PENDING` with `basis`, `language: languageFromContent(workspace.contentLanguage)`, `competitorSet` (max 12, as the old action did); P2002 on the partial index → `matrixAlreadyRunning`; `triggerBackgroundRun('/api/matrices/run', { runId })`; on `{ ok: false }` mark FAILED with `DISPATCH_FAILED` (use `withRunErrorCode`/`RUN_ERROR` from `@/lib/competitors/run-errors`) and return `matrixDispatchFailed` — unless the guarded update matched nothing, then return `{ runId }`. Activity log `MATRICES_STARTED`.
- `getMatrixStatus`: reap, then latest run by `startedAt`, never exposing raw `error` (map to `errorKind` with `classifyRunError`).
- `saveMatrixAxes`: `parseStoredMarketAxes(axes)`; zero axes → `matrixAxesRequired`; save `Workspace.matrixAxes`; then behave exactly like `startMatrixRun`.
- Overrides: `chartKey` must exist on the latest DONE run; `competitorId` must be null or one of that run's scores; clamp scores to 1..10 integers; note ≤ 280 chars; upsert (unique on the three fields); `rebuildMatricesProjection`; activity log `MATRIX_SCORE_OVERRIDDEN` / `MATRIX_SCORE_OVERRIDE_CLEARED`. Return the new projection.
- Delete `generateWorkspaceCompetitiveMatrices`, `saveWorkspaceCompetitiveMatricesEdits`, `fallbackMatrices`, `heuristicPointScore`, `hashString`, `CHART_DEFINITIONS` and every helper only they used. Keep the exported types `MatrixCompanyPoint` and `CompetitiveMatrixChart` only if something outside still imports them after Task 12; otherwise delete.

New error keys (en/fa): `matrixAlreadyRunning`, `matrixDispatchFailed`, `matrixNeedsBrandSummary`, `matrixAxesRequired`, `matrixOverrideInvalid`. Persian written, not translated.

- [ ] **Step 1: Failing tests** following `growth-competitors.test.ts` (mock `@/lib/background-run`, `@/lib/matrices/pipeline`, `@/lib/matrices/persist`): not-owned workspace; already running; basis NONE; no brand summary; dispatch failure marks FAILED; P2002 → already running; `saveMatrixAxes` saves then dispatches; override on an unknown chart → `matrixOverrideInvalid`; override clamps 14 → 10 and rebuilds the projection; clearing deletes and rebuilds.
- [ ] **Step 2: Implement. Step 3: pass (full suite; the old matrices test is gone). Step 4: Commit.**

---

### Task 11: Downstream readers

**Files:**
- Modify: `apps/web/src/lib/report-readiness.ts:26` (`REQUIRED_MATRIX_CHARTS = 3`)
- Modify: `apps/web/src/lib/workspace-journey.ts:250` (`>= 5` → `>= REQUIRED_MATRIX_CHARTS`, imported)
- Modify: `apps/api/src/modules/workspaces/strategic-report-eligibility.service.ts:71` (`>= 5` → `>= 3`, named constant with a comment pointing to the web constant)
- Modify: `apps/web/src/lib/content-engine.ts:220-228` (gate: `charts.length >= REQUIRED_MATRIX_CHARTS` and `competitor_basis` present and not `'NONE'`; a legacy blob without `run_id` still passes if it has ≥ 3 charts, so existing workspaces do not lose ideation overnight — pass the basis into the ideation prompt as `competitorBasis`, and `'UNKNOWN'` when missing)
- Modify: `apps/web/src/lib/gemini.ts:489-529` (`summarizeMarketMetricContext`: add each chart's `content_angles` and a one-line white-space note when present)
- Modify: `apps/web/src/lib/ai-report-designer.ts:42-55` (read `website` — the stored field — instead of the non-existent `domain`)
- Modify: `apps/web/src/app/[locale]/(dashboard)/growth/[id]/page.tsx:300-318` (read `tokens_used` from the projection when present, else the legacy `token_usage.lifetime_total_tokens`)
- Tests: extend `apps/web/src/lib/report-readiness` tests if present, else create `report-readiness.test.ts` (3 charts ready, 2 not); add a `content-engine` gate test if the file has tests, else a focused test of an extracted pure `matricesGate(matrices): string | null`.

- [ ] **Step 1: Failing tests. Step 2: Implement. Step 3: pass, and `cd apps/api && npx tsc --noEmit -p tsconfig.json`. Step 4: Commit.**

---

### Task 12: UI — run header, polling and axes chooser

**Files:**
- Create: `.../growth/[id]/_components/matrices/matrix-run-logic.ts` + `.test.ts`
- Create: `.../growth/[id]/_components/matrices/MatrixRunHeader.tsx`
- Create: `.../growth/[id]/_components/matrices/AxesChooser.tsx`
- Modify: `CompetitiveMatricesTab.tsx` (matrix half only; the competitors half above line 245 is untouched)
- Modify: `apps/web/messages/{en,fa}/tabs-b.json`

**Interfaces:**
- `matrix-run-logic.ts`: `POLL_INTERVAL_MS = 3000`, `MAX_POLL_MS = 15 * 60 * 1000`, `isMatrixRunActive(status)`, `shouldKeepPolling(run, nowMs)`, `stageIndex(stage)`, `MATRIX_STAGE_ORDER = ['AXES','SCORE','SUMMARISE','SAVE']`, `emptyStateReason(status: MatrixStatus): 'competitors' | 'brandSummary' | null`, `basisNotice(matrices): 'accepted' | 'unconfirmed' | 'legacy'` (legacy = no `run_id`).
- Header (spec §6.1): basis label, competitor count (`format.number`), last run date (`format.dateTime`), stale banner with regenerate, run button, stage list during a run (same visual as `CompetitorDiscoveryPanel` stages), failure message by `errorKind`, empty state naming what is missing with a link to the competitors section or brand memory, and the legacy notice "this matrix predates the evidence rule — regenerate to be sure".
- Axes chooser (§6.2): shown when the latest run is `NEEDS_AXES`, and behind an "Axes" button later. Two locked core chips; the 4 candidates as toggles, the first 2 preselected, max 3; inline rename of both labels per candidate; rationale under each; "Build the charts" calls `saveMatrixAxes` and starts polling.
- Polling copies `CompetitorMapManager`'s loop (interval + `inFlight` guard + stop condition) using `getMatrixStatus`; on active → finished it calls `router.refresh()`.
- Remove the global Generate/Save buttons, `showEditScores`, the fine-tune editor and `saveEdits`/`updateScore`.

- [ ] **Step 1: Failing logic tests. Step 2: Implement components. Step 3: tests, typecheck, lint, i18n. Step 4: Commit.**

---

### Task 13: UI — chart, point drawer, summaries, technical disclosure

**Files:**
- Create: `.../matrices/MatrixChart.tsx`, `.../matrices/PointDrawer.tsx`, `.../matrices/ChartInsights.tsx`, `.../matrices/TechnicalDetails.tsx`, `.../matrices/chart-geometry.ts` + `.test.ts`
- Modify: `CompetitiveMatricesTab.tsx`, messages.

**Interfaces:**
- `chart-geometry.ts`: `scoreToPercent(score: number): number` (existing formula `10 + ((clamp(1..10) - 1) / 9) * 80`), `bandRect(band: 0|1|2): { start: number; size: number }` in percent using the same thirds as `axisThird` (1–4, 5–7, 8–10), `cornerLabels(axis): { topLeft; topRight; bottomLeft; bottomRight }` from `x.low/x.high` and `y.low/y.high`.
- Chart (§6.3): keep the hand-built absolutely-positioned plot (no chart library), taller; corner labels; white-space cell hatched in saffron (use existing saffron token classes, no inline styles); target as the saffron point; `estimated` points hollow; overridden points with a small pencil icon (lucide `Pencil`) and a faint line to the AI position (`override.ai_x_score/ai_y_score`).
- Drawer (§6.4): opens on point click; both reasons; evidence list resolved against the competitor's evidence (ids not found are dropped; if none resolve, show "the evidence is no longer available"); confidence as a word (`confidence_band`); two steppers 1–10 that call `setMatrixOverride` on change and show an undo toast (undo = previous value, or `clearMatrixOverride` if there was none); "Back to the AI's score" → `clearMatrixOverride`.
- Insights (§6.5, §6.6): market pattern, opportunity, "What content this chart gives you" with the angles and their audience segment; the top summary card (strongest differentiation, target audience segment, cross-chart summary). "Send to ideation" buttons are **out of scope** for this task (spec leaves wiring to the plan; defer, and say so in the final report).
- Technical disclosure (§6.7, M8): `<details>` collapsed by default with run id, model, tokens (`format.number`), basis. Remove the old token panel and `showTokens`.
- Legacy blobs (no `chart_kind`, no `white_space`) must still render: treat missing fields as absent.

- [ ] **Step 1: Failing geometry tests. Step 2: Implement. Step 3: tests, typecheck, lint, i18n. Step 4: Commit.**

---

### Task 14: End-to-end verification and cleanup

- [ ] **Step 1:** Full suite, typecheck (web and api), lint, i18n, and `pnpm build` inside this worktree.
- [ ] **Step 2:** `grep -rn "fallbackMatrices\|heuristicPointScore\|hashString\|saveWorkspaceCompetitiveMatricesEdits\|generateWorkspaceCompetitiveMatrices" apps/` returns nothing.
- [ ] **Step 3: Live run** on the local app (start the web dev server from this worktree on a free port, never the shared checkout's). A human signs in (token minting is blocked in this project). One Persian and one English workspace with ≥ 2 accepted competitors and a brand summary: first run stops at the axes chooser; pick 2; the run reaches DONE with 4 charts; check evidence links, a hollow estimated point if any, an override survives a second run, the stale banner after accepting another competitor, and ideation blocked on a workspace with < 3 charts. Record tokens per run.
- [ ] **Step 4:** Cost note in the final report: tokens per run for both workspaces. Farjad sets the ceiling himself.
- [ ] **Step 5:** Push the branch and open a PR with a ship checklist: migration first (`railway run --service contivo-api npx prisma migrate deploy` from a plain clone at the merge commit, confirm `Applying migration 20260929000000_positioning_matrices`), then `railway up --service contivo-web` and `railway up --service contivo-api` (the API eligibility constant changed).

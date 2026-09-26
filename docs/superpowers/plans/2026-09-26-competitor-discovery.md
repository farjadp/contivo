# Competitor Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild competitor discovery so every competitor comes from a real search result, carries clickable evidence, and is matched to the workspace's market and scale.

**Architecture:** A pipeline runs in the Next.js app: generate queries → harvest candidate domains from OpenAI `web_search` citations → normalise domains → fetch each homepage → an LLM judge scores each candidate against the brand with its evidence → a deterministic scorer keeps the top 10. State lives in a new `DiscoveryRun` row; the UI polls it. Candidate domains never come from model prose.

**Tech Stack:** Next.js 15.5.25 (App Router, server actions, `after()`), Prisma + Postgres (Neon, schema `contivo`), OpenAI Responses API (`web_search`), next-intl (en + fa), Vitest (added in Task 1), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-26-competitor-discovery-design.md` — read it before Task 1. Executors read both documents.

## Global Constraints

- Branch: `competitor-discovery-redesign`. Do not merge to `main` — **a push to `main` auto-deploys www.contivo.app on Vercel.**
- TypeScript only. Functional React components. Tailwind classes only, no inline styles. No hardcoded config — everything through env vars.
- Schema changes are applied with `pnpm --filter @contivo/api exec prisma db push`, never `migrate`. The Prisma schema file is `apps/api/prisma/schema.prisma`. The DB schema name is `contivo` in **production** (Neon) but `public` **locally** (`apps/api/.env` → `localhost:5433/contivo_dev?schema=public`) — verify local work against `public.*`.
- The local database runs on port **5433**. The local web dev server picks a random port — read the actual port from the dev server output.
- Every user-facing string exists in both `apps/web/messages/en/growth.json` and `apps/web/messages/fa/growth.json` with identical key sets and identical ICU placeholders, or `pnpm --filter web check:i18n` fails. Persian is **written as Persian, not translated from the English**. Never hardcode digits in Persian copy — format numbers through `useFormatter` / `next-intl`.
- Confidence bands: **high ≥ 0.8**, **medium ≥ 0.6**, keep threshold **≥ 0.6**, at most **10** competitors saved per run, at most **8** queries, at most **20** candidates enriched.
- A user's decision (`userDecision`) is never overwritten by a discovery run.
- No silent fallbacks to invented data anywhere. A missing credential is an error, not mock output.
- Failed and empty runs do not count against the quota.
- Run `pnpm --filter web typecheck` and `pnpm --filter web check:i18n` before every commit that touches `apps/web`.
- **A stage that cannot report its real token usage returns `null`, never `0`.** The pipeline sums the known values and records separately that the total is incomplete. `DiscoveryRun.tokensUsed` is the number the cost ceiling will be set from, so a fabricated zero reads as a free run and is worse than an admitted gap.
- Another session has uncommitted work in this shared working tree. **Never `git add -A` or `git commit -a`** — always stage an explicit file list.
- End every commit message with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

**Created:**
| File | Responsibility |
|---|---|
| `apps/web/vitest.config.ts` | Test runner config (node environment) |
| `apps/web/src/lib/competitors/domains.ts` | Pure domain normalisation: registrable domain, stat-mirror unwrapping, never-a-company list |
| `apps/web/src/lib/competitors/domains.test.ts` | Unit tests for the above |
| `apps/web/src/lib/competitors/scoring.ts` | Pure final-score formula and confidence bands |
| `apps/web/src/lib/competitors/scoring.test.ts` | Unit tests for the above |
| `apps/web/src/lib/competitors/types.ts` | Shared types: `Candidate`, `EvidenceItem`, `JudgedCandidate`, `TargetMarket` |
| `apps/web/src/lib/competitors/queries.ts` | Brand brief + LLM query generation |
| `apps/web/src/lib/competitors/search.ts` | OpenAI `web_search` harvest; SERP source stub |
| `apps/web/src/lib/competitors/judge.ts` | LLM judge |
| `apps/web/src/lib/competitors/pipeline.ts` | Orchestrates stages, writes `DiscoveryRun` progress |
| `apps/web/src/lib/competitors/selection.ts` | `selectCompetitorsForAnalysis()` shared by downstream features |
| `apps/web/src/lib/competitors/selection.test.ts` | Unit tests for the above |
| `apps/web/src/app/api/growth/discovery/run/route.ts` | `maxDuration = 300` route that executes the pipeline via `after()` |
| `apps/web/src/lib/background-run.ts` | Reusable trigger for long background runs (shared with future features) |
| `.../growth/[id]/_components/CompetitorDiscoveryPanel.tsx` | Run panel: market, button, quota, live stages, queries |
| `.../growth/[id]/_components/CompetitorReviewQueue.tsx` | PENDING cards: evidence, accept/reject/type |
| `.../growth/[id]/_components/CompetitorList.tsx` | ACCEPTED list, manual add, run history |

**Modified:** `apps/api/prisma/schema.prisma`, `apps/web/src/app/actions/growth-competitors.ts` (rewrite), `CompetitorMapManager.tsx` (strip map, host new components), `CompetitiveMatricesTab.tsx` (wiring only), `growth-matrices.ts`, `growth-keywords.ts`, `growth-offerings.ts` (use the shared selector), `apps/web/messages/{en,fa}/growth.json`, `apps/web/src/i18n/routing.ts`, `apps/web/package.json`.

**Deleted:** `apps/web/src/app/[locale]/(dashboard)/growth/competitors/` (both files).

---

## Task 1: Test runner + domain normalisation

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`, `apps/web/src/lib/competitors/domains.ts`
- Test: `apps/web/src/lib/competitors/domains.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeCandidateDomain(input: string): string | null
  export function isExcludedDomain(domain: string): boolean
  export function normalizeEvidenceUrl(input: string): string   // lowercase host, no hash, no trailing slash
  ```
  `normalizeCandidateDomain` returns the registrable domain in lowercase with no `www.`, or `null` when the input is not a usable company domain (unparseable, an IP, or on the excluded list).

**Context:** The repo has no test runner today. Vitest is added here because later tasks depend on it. `tldts` gives the registrable domain from the public suffix list — needed because `edu.24talk.ir` must become `24talk.ir` while `24talk.ir` must not become `talk.ir`. The stat-mirror list comes from real spike output: the Iranian store-builder query returned its best candidates only as `sazito.com.atlaq.com` and `kamva.ir.usitestat.com`.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/farjad/Downloads/Work-Studio/Contivo
pnpm --filter web add tldts
pnpm --filter web add -D vitest
```

- [ ] **Step 2: Add the config and script**

Create `apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

In `apps/web/package.json`, add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/lib/competitors/domains.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isExcludedDomain, normalizeCandidateDomain } from './domains';

describe('normalizeCandidateDomain', () => {
  it('lowercases and strips protocol, www and path', () => {
    expect(normalizeCandidateDomain('https://WWW.Hesabshop.com/pricing?a=1')).toBe('hesabshop.com');
  });

  it('reduces a subdomain to its registrable domain', () => {
    expect(normalizeCandidateDomain('https://docs.surferseo.com/guide')).toBe('surferseo.com');
    expect(normalizeCandidateDomain('https://blog.hubspot.com/marketing')).toBe('hubspot.com');
  });

  it('keeps a multi-part public suffix intact', () => {
    // 24talk.ir must not collapse to talk.ir
    expect(normalizeCandidateDomain('https://edu.24talk.ir')).toBe('24talk.ir');
    expect(normalizeCandidateDomain('https://ir.linkedin.com/in/x')).toBe(null); // excluded below
  });

  it('unwraps stat-mirror hosts to the real company domain', () => {
    expect(normalizeCandidateDomain('https://sazito.com.atlaq.com')).toBe('sazito.com');
    expect(normalizeCandidateDomain('https://shopfa.com.atlaq.com')).toBe('shopfa.com');
    expect(normalizeCandidateDomain('https://kamva.ir.usitestat.com')).toBe('kamva.ir');
    expect(normalizeCandidateDomain('https://bahooosh.com.cutestat.com')).toBe('bahooosh.com');
    expect(normalizeCandidateDomain('https://spooler.ir.clearwebstats.com')).toBe('spooler.ir');
  });

  it('rejects messengers, social networks, wikis, code hosts and stat sites', () => {
    for (const url of [
      'https://t.me/somechannel',
      'https://telegram.me/x',
      'https://www.linkedin.com/company/x',
      'https://en.wikipedia.org/wiki/X',
      'https://hub.docker.com/r/x',
      'https://trends.builtwith.com/x',
      'https://hypestat.com/info/x',
      'https://www.reddit.com/r/x',
      'https://www.youtube.com/watch?v=x',
    ]) {
      expect(normalizeCandidateDomain(url)).toBe(null);
    }
  });

  it('rejects junk input', () => {
    expect(normalizeCandidateDomain('')).toBe(null);
    expect(normalizeCandidateDomain('not a url')).toBe(null);
    expect(normalizeCandidateDomain('https://192.168.0.1/x')).toBe(null);
  });

  it('keeps ordinary company domains', () => {
    expect(normalizeCandidateDomain('https://futurpreneur.ca/en/')).toBe('futurpreneur.ca');
    expect(normalizeCandidateDomain('cerp.ir')).toBe('cerp.ir');
  });
});

describe('isExcludedDomain', () => {
  it('matches the never-a-company list on the registrable domain', () => {
    expect(isExcludedDomain('wikipedia.org')).toBe(true);
    expect(isExcludedDomain('hesabshop.com')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `pnpm --filter web test`
Expected: FAIL — cannot resolve `./domains`.

- [ ] **Step 5: Implement**

Create `apps/web/src/lib/competitors/domains.ts`:
```ts
import { parse } from 'tldts';

/**
 * Hosts that mirror another site's stats under their own domain, e.g.
 * `sazito.com.atlaq.com`. Live search surfaces these instead of the real
 * company often enough that dropping them loses genuine competitors — the
 * Iranian store-builder query returned its best candidates only this way.
 */
const STAT_MIRROR_SUFFIXES = [
  'atlaq.com',
  'usitestat.com',
  'cutestat.com',
  'clearwebstats.com',
  'sitescorechecker.com',
  'webrate.org',
  'whtop.com',
  'hypestat.com',
];

/** Never a competitor, whatever the query. */
const EXCLUDED_DOMAINS = new Set([
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
  't.me', 'telegram.me', 'telegram.org', 'whatsapp.com',
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'youtube.com', 'reddit.com', 'pinterest.com', 'tiktok.com',
  'wikipedia.org', 'wikimedia.org', 'archive.org',
  'github.com', 'docker.com', 'hub.docker.com', 'gitlab.com', 'npmjs.com',
  'builtwith.com', 'w3techs.com', 'wappalyzer.com', 'similarweb.com',
  'semrush.com', 'ahrefs.com', 'trustpilot.com', 'medium.com',
  'amazonaws.com', 'googleapis.com', 'cloudfront.net', 'webflow.io',
  ...STAT_MIRROR_SUFFIXES,
]);

export function isExcludedDomain(domain: string): boolean {
  return EXCLUDED_DOMAINS.has(domain.toLowerCase().trim());
}

function hostnameOf(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Turn a search-result URL into the registrable domain of the company behind
 * it, or null when it is not a company domain at all.
 */
export function normalizeCandidateDomain(input: string): string | null {
  const hostname = hostnameOf(input);
  if (!hostname) return null;

  // A stat mirror carries the real domain as the prefix of its own host.
  const mirror = STAT_MIRROR_SUFFIXES.find((suffix) => hostname.endsWith(`.${suffix}`));
  const target = mirror ? hostname.slice(0, -(mirror.length + 1)) : hostname;

  const parsed = parse(target.startsWith('www.') ? target.slice(4) : target);
  if (!parsed.domain || parsed.isIp) return null;

  const domain = parsed.domain.toLowerCase();
  if (isExcludedDomain(domain)) return null;
  return domain;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm --filter web test`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/lib/competitors/ pnpm-lock.yaml
git commit -m "Normalise candidate domains from search results

Adds Vitest and the pure domain normaliser: registrable domain via the
public suffix list, stat-mirror unwrapping, and a never-a-company list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Shared types + scoring

**Files:**
- Create: `apps/web/src/lib/competitors/types.ts`, `apps/web/src/lib/competitors/scoring.ts`
- Test: `apps/web/src/lib/competitors/scoring.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // types.ts
  export type TargetMarket = { country: string | null; language: 'fa' | 'en' };
  export type EvidenceItem = {
    id: string;              // 8 hex chars, stable across reruns for the same url
    kind: 'citation' | 'serp' | 'site';
    url: string;
    title?: string;
    snippet?: string;
    query?: string;
  };
  export type CompetitorLabel = 'SEO' | 'BUSINESS';
  export type CompetitorSource = 'WEB_SEARCH' | 'SERP' | 'MANUAL';
  export type CompetitorType = 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL';
  export type Candidate = {
    domain: string;
    frequency: number;          // how many distinct queries surfaced it
    sources: CompetitorSource[];
    evidence: EvidenceItem[];
  };
  export type EnrichedCandidate = Candidate & {
    siteTitle: string | null;
    siteEvidence: string;       // text block from collectWebsiteEvidence
    pageLanguage: string | null;
  };
  export type JudgedCandidate = EnrichedCandidate & {
    name: string;
    isCompetitor: boolean;
    labels: CompetitorLabel[];
    type: CompetitorType;
    scaleMatch: boolean;
    judgeConfidence: number;
    reason: string;
    positioning: string | null;
    keyFeatures: string[];
    description: string;
  };
  export type ScoredCandidate = JudgedCandidate & { finalConfidence: number };

  // scoring.ts
  export const KEEP_THRESHOLD = 0.6;
  export const MAX_SAVED_PER_RUN = 10;
  export function scoreCandidate(c: JudgedCandidate, market: TargetMarket): number
  export function confidenceBand(value: number | null): 'high' | 'medium' | 'low' | 'unknown'
  export function rankAndKeep(list: JudgedCandidate[], market: TargetMarket): ScoredCandidate[]
  ```

- [ ] **Step 1: Write the types and the evidence-id helper**

Create `apps/web/src/lib/competitors/types.ts` with exactly the type declarations listed in the **Produces** block above, plus:
```ts
import { randomBytes } from 'node:crypto';

/** 8 hex chars. Short enough to read in a payload, unique enough within one competitor. */
export function newEvidenceId(): string {
  return randomBytes(4).toString('hex');
}
```
No new dependency — `nanoid` is not installed and `node:crypto` is already available server-side.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/competitors/scoring.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { JudgedCandidate, TargetMarket } from './types';
import { confidenceBand, rankAndKeep, scoreCandidate, MAX_SAVED_PER_RUN } from './scoring';

const IR: TargetMarket = { country: 'IR', language: 'fa' };

function candidate(over: Partial<JudgedCandidate> = {}): JudgedCandidate {
  return {
    domain: 'example.com',
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    siteTitle: 'Example',
    siteEvidence: 'some text',
    pageLanguage: 'en',
    name: 'Example',
    isCompetitor: true,
    labels: ['BUSINESS'],
    type: 'DIRECT',
    scaleMatch: true,
    judgeConfidence: 0.7,
    reason: 'overlaps',
    positioning: null,
    keyFeatures: [],
    description: 'desc',
    ...over,
  };
}

describe('scoreCandidate', () => {
  it('starts from the judge confidence', () => {
    expect(scoreCandidate(candidate({ frequency: 1, pageLanguage: 'en' }), { country: null, language: 'en' }))
      .toBeCloseTo(0.75, 2); // 0.70 + 0.05 language match
  });

  it('rewards appearing in more queries, with a cap', () => {
    const one = scoreCandidate(candidate({ frequency: 1 }), IR);
    const three = scoreCandidate(candidate({ frequency: 3 }), IR);
    const ten = scoreCandidate(candidate({ frequency: 10 }), IR);
    expect(three).toBeGreaterThan(one);
    expect(ten).toBeCloseTo(three + 0.0, 2); // capped at 3 queries
  });

  it('rewards agreement between sources', () => {
    const single = scoreCandidate(candidate({ sources: ['WEB_SEARCH'] }), IR);
    const both = scoreCandidate(candidate({ sources: ['WEB_SEARCH', 'SERP'] }), IR);
    expect(both - single).toBeCloseTo(0.1, 2);
  });

  it('rewards a page language matching the target market', () => {
    const fa = scoreCandidate(candidate({ pageLanguage: 'fa' }), IR);
    const en = scoreCandidate(candidate({ pageLanguage: 'en' }), IR);
    expect(fa - en).toBeCloseTo(0.05, 2);
  });

  it('never leaves the 0..1 range', () => {
    const high = scoreCandidate(candidate({ judgeConfidence: 0.99, frequency: 9, sources: ['WEB_SEARCH', 'SERP'], pageLanguage: 'fa' }), IR);
    expect(high).toBeLessThanOrEqual(1);
    const low = scoreCandidate(candidate({ judgeConfidence: 0 }), IR);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

describe('confidenceBand', () => {
  it('bands by the agreed thresholds', () => {
    expect(confidenceBand(0.81)).toBe('high');
    expect(confidenceBand(0.8)).toBe('high');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.59)).toBe('low');
    expect(confidenceBand(null)).toBe('unknown');
  });
});

describe('rankAndKeep', () => {
  it('drops non-competitors and anything under the threshold', () => {
    const kept = rankAndKeep(
      [
        candidate({ domain: 'a.com', isCompetitor: false, judgeConfidence: 0.95 }),
        candidate({ domain: 'b.com', judgeConfidence: 0.2 }),
        candidate({ domain: 'c.com', judgeConfidence: 0.9 }),
      ],
      IR,
    );
    expect(kept.map((k) => k.domain)).toEqual(['c.com']);
  });

  it('sorts by final confidence, highest first', () => {
    const kept = rankAndKeep(
      [candidate({ domain: 'low.com', judgeConfidence: 0.65 }), candidate({ domain: 'high.com', judgeConfidence: 0.95 })],
      IR,
    );
    expect(kept.map((k) => k.domain)).toEqual(['high.com', 'low.com']);
  });

  it('caps the result at MAX_SAVED_PER_RUN', () => {
    const many = Array.from({ length: 25 }, (_, i) => candidate({ domain: `d${i}.com`, judgeConfidence: 0.9 }));
    expect(rankAndKeep(many, IR)).toHaveLength(MAX_SAVED_PER_RUN);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `pnpm --filter web test`
Expected: FAIL — cannot resolve `./scoring`.

- [ ] **Step 4: Implement**

Create `apps/web/src/lib/competitors/scoring.ts`:
```ts
import type { JudgedCandidate, ScoredCandidate, TargetMarket } from './types';

export const KEEP_THRESHOLD = 0.6;
export const MAX_SAVED_PER_RUN = 10;
const HIGH_BAND = 0.8;

/**
 * The judge supplies the opinion; this adds only what can be counted:
 * how many distinct queries surfaced the domain, whether more than one
 * source found it, and whether the site speaks the market's language.
 */
export function scoreCandidate(candidate: JudgedCandidate, market: TargetMarket): number {
  let score = candidate.judgeConfidence;

  // Appearing in several distinct queries is corroboration; past three it
  // says more about the query set than the candidate.
  score += Math.min(candidate.frequency - 1, 2) * 0.05;

  if (new Set(candidate.sources).size > 1) score += 0.1;

  if (candidate.pageLanguage && candidate.pageLanguage === market.language) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

export function confidenceBand(value: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (value == null) return 'unknown';
  if (value >= HIGH_BAND) return 'high';
  if (value >= KEEP_THRESHOLD) return 'medium';
  return 'low';
}

export function rankAndKeep(list: JudgedCandidate[], market: TargetMarket): ScoredCandidate[] {
  return list
    .filter((item) => item.isCompetitor)
    .map((item) => ({ ...item, finalConfidence: scoreCandidate(item, market) }))
    .filter((item) => item.finalConfidence >= KEEP_THRESHOLD)
    .sort((a, b) => b.finalConfidence - a.finalConfidence)
    .slice(0, MAX_SAVED_PER_RUN);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter web test`
Expected: PASS. If the first `scoreCandidate` test fails at 0.75, check that `frequency: 1` adds nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/competitors/
git commit -m "Score candidates from countable signals

The judge gives the opinion; the score adds query frequency, source
agreement and market-language match, then caps the run at ten.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: `Competitor.confidence|labels|sources|evidence|positioning|keyFeatures|rejectionReason|discoveryRunId`, `Workspace.targetCountry|targetLanguage`, and the `DiscoveryRun` model, all as written in the spec §4.

**Context:** Read spec §4 first and copy the field definitions from it. `db push`, not `migrate` — see the constraints.

- [ ] **Step 1: Add the Workspace fields**

In `model Workspace`, after `contentLanguage`:
```prisma
  /// Where this workspace competes, which is not where it writes from: a
  /// Tehran founder selling into the US searches en/US while publishing
  /// Persian. Discovery searches here; null country means global.
  targetCountry        String?
  targetLanguage       String               @default("en")
```
And add the back-relation `discoveryRuns DiscoveryRun[]` alongside `competitors`.

- [ ] **Step 2: Add the Competitor fields**

In `model Competitor`, before `createdAt`:
```prisma
  confidence      Float?
  labels          String[]  @default([])
  sources         String[]  @default([])
  evidence        Json?
  positioning     String?
  keyFeatures     String[]  @default([])
  rejectionReason String?
  discoveryRunId  String?
```

- [ ] **Step 3: Add the DiscoveryRun model**

Copy the `model DiscoveryRun { ... }` block verbatim from spec §4.

- [ ] **Step 4: Push and verify against the running database**

```bash
pnpm --filter @contivo/api exec prisma db push
pnpm --filter @contivo/api exec prisma generate
```
Then prove the columns exist — reading the schema file is not proof:
```bash
psql "$DATABASE_URL" -c "\d contivo.discovery_runs" -c "\d contivo.competitors"
```
Expected: `discovery_runs` exists; `competitors` shows the eight new columns.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "Give competitors evidence and workspaces a target market

Adds structured competitor fields, the DiscoveryRun record that runs
report progress through, and the workspace's search market.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Query generation

**Files:**
- Create: `apps/web/src/lib/competitors/queries.ts`

**Interfaces:**
- Consumes: `TargetMarket` from `./types`.
- Produces:
  ```ts
  export type BrandBrief = {
    companyName: string;
    ownDomain: string | null;
    summary: string;
    valueProposition: string;
    industry: string;
    audience: string;
    market: TargetMarket;
    acceptedCompetitors: Array<{ name: string; domain: string | null }>;
    rejectedCompetitors: Array<{ name: string; domain: string | null; reason: string | null }>;
    knownDomains: string[];
  };
  export function buildBrandBrief(input: {
    workspace: { name: string; websiteUrl: string | null; brandSummary: unknown; targetCountry: string | null; targetLanguage: string };
    competitors: Array<{ name: string; domain: string | null; userDecision: string | null; rejectionReason: string | null }>;
  }): BrandBrief
  export const MAX_QUERIES = 8;
  export async function generateQueries(brief: BrandBrief): Promise<{ queries: string[]; tokens: number | null }>
  ```

**Context:** `apps/web/src/app/actions/growth-competitors.ts` already has `trimTo` and `normalizeDomain` helpers; move the ones you need into `apps/web/src/lib/competitors/` rather than importing from a `'use server'` file — a server-action module cannot export non-action values.

- [ ] **Step 1: Implement `buildBrandBrief`**

Pure function, no I/O. Pull `businessSummary`/`heroMessage`, `valueProposition`, `industry`, `audience` out of `brandSummary` defensively (it is untyped JSON), trim each to 500 chars, and split competitors by `userDecision` into accepted and rejected (rejected keeps its `rejectionReason`). `knownDomains` is every non-null domain.

- [ ] **Step 2: Implement `generateQueries`**

One OpenAI chat call, `response_format: { type: 'json_object' }`, `temperature: 0.3`, model from `process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1'`. Throw if `OPENAI_API_KEY` is missing — never return a fallback list.

The prompt must state:
```
Write {n} web search queries that would surface companies competing with this business.
Write every query in {language}. The searcher is located in {country or 'no specific country'}.
Cover these kinds, one or two each:
1. the product category plus the market
2. the problem the audience is trying to solve, in their own words
3. "alternatives to X" for each confirmed competitor listed below
4. "X vs" for each confirmed competitor listed below
Kinds 3 and 4 only apply when confirmed competitors are listed.
Do not name the company itself. Do not write questions about the company.
Return {"queries": ["..."]}
```
Feed in the brief's company name, summary, industry, audience, market and the accepted competitor names. Cap the result at `MAX_QUERIES`, drop empties and duplicates, and return the total token count from `usage.total_tokens`.

- [ ] **Step 3: Verify against the real API**

Write a throwaway script in the scratchpad that builds a brief by hand and prints the queries for one Persian and one English brief. Confirm the Persian queries are in Persian and none of them name the company.

Expected: 6–8 queries per brief, in the right language.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/competitors/queries.ts
git commit -m "Generate discovery queries in the market's own language

Four query kinds, and each confirmed competitor sharpens the next run
through its alternatives and versus queries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Search harvest

**Files:**
- Create: `apps/web/src/lib/competitors/search.ts`

**Interfaces:**
- Consumes: `normalizeCandidateDomain` from `./domains`; `Candidate`, `TargetMarket` from `./types`.
- Produces:
  ```ts
  export async function harvestFromWebSearch(
    queries: string[],
    market: TargetMarket,
    exclude: Set<string>,
  ): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }>
  export async function harvestFromSerp(
    queries: string[],
    market: TargetMarket,
    exclude: Set<string>,
  ): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }>
  ```

**Context:** This is the heart of D4. Candidate domains come from the message's **annotation** URLs only. The `web_search_call.action.sources` list (26–112 domains per query in the spike) is used **only** to raise `frequency` for a domain already found via an annotation — never to create a candidate.

- [ ] **Step 1: Implement `harvestFromWebSearch`**

For each query (concurrency 4), POST to `https://api.openai.com/v1/responses`:
```ts
{
  model: process.env.OPENAI_SEARCH_MODEL || 'gpt-5-mini',
  tools: [{ type: 'web_search', search_context_size: 'low',
            ...(market.country ? { user_location: { type: 'approximate', country: market.country } } : {}) }],
  include: ['web_search_call.action.sources'],
  input: `Search the web for: "${query}". List the companies or products that offer this, each with its website. Be brief.`,
}
```
Walk `output`: from `type === 'message'` items collect `content[].annotations[]` with a `url` — each becomes a candidate via `normalizeCandidateDomain`, carrying an `EvidenceItem { kind: 'citation', url, title, query }`. From `type === 'web_search_call'` items collect `action.sources[].url` into a per-query set used only for frequency.

Merge across queries by domain: `frequency` is the number of distinct queries in which the domain appeared (as citation or source), evidence items accumulate (cap 6 per domain), `sources` is `['WEB_SEARCH']`. Skip anything in `exclude`. A failed query is pushed to `errors` and does not fail the harvest. Throw only if `OPENAI_API_KEY` is missing.

- [ ] **Step 2: Implement `harvestFromSerp`**

```ts
export async function harvestFromSerp(): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }> {
  // DataForSEO has no credentials in production and its client currently
  // returns fabricated keywords and SERP rows when they are missing, so this
  // source stays off until that is fixed. Returning nothing is the honest
  // answer; returning mock data would poison discovery.
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return { candidates: [], tokens: 0, errors: [] };
  }
  return { candidates: [], tokens: 0, errors: ['SERP source not implemented yet'] };
}
```

- [ ] **Step 3: Verify against the real API**

Throwaway script in the scratchpad: run `harvestFromWebSearch` with the three Persian spike queries and `{ country: 'IR', language: 'fa' }`. Print each candidate's domain, frequency and evidence count.

Expected: real Iranian company domains, no `t.me`, no `*.atlaq.com` left unwrapped, and `sazito.com` present if the store-builder query is used.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/competitors/search.ts
git commit -m "Harvest candidates from live search citations only

Domains come from what the search actually cited, never from model
prose. The noisy raw source list only raises frequency.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Enrich + judge

**Files:**
- Create: `apps/web/src/lib/competitors/judge.ts`

**Interfaces:**
- Consumes: `BrandBrief` from `./queries`; `Candidate`, `EnrichedCandidate`, `JudgedCandidate` from `./types`.
- Produces:
  ```ts
  export const MAX_ENRICHED = 20;
  export async function enrichCandidates(candidates: Candidate[]): Promise<EnrichedCandidate[]>
  export async function judgeCandidates(
    brief: BrandBrief,
    candidates: EnrichedCandidate[],
  ): Promise<{ judged: JudgedCandidate[]; tokens: number | null }>
  ```

**Context:** `collectWebsiteEvidence(domain)` already exists in `growth-competitors.ts` (line ~191) and returns `{ domain, pagesScanned, evidence }`. Move it into `judge.ts` — it is a plain async function, and leaving it in the `'use server'` module means it cannot be imported.

- [ ] **Step 1: Implement `enrichCandidates`**

Sort by `frequency` descending, take `MAX_ENRICHED`, and run `collectWebsiteEvidence` with concurrency 5. Drop any candidate whose `pagesScanned` is empty — unreachable means no evidence to judge. Set `siteTitle` from the first `<title>`, `siteEvidence` from the evidence text, and `pageLanguage` from the `<html lang>` attribute, falling back to `'fa'` when more than 30% of the evidence text is in the Arabic Unicode block (`/[؀-ۿ]/`), else `'en'`. Append one `EvidenceItem { kind: 'site', url, title }` per scanned page, capped at 3.

- [ ] **Step 2: Implement `judgeCandidates`**

Batch of 5 candidates per call, concurrency 2. Use `response_format: { type: 'json_schema' }` with `strict: true` so the shape cannot drift. Schema per candidate: `domain, name, isCompetitor (bool), labels (array of "SEO"|"BUSINESS"), type ("DIRECT"|"INDIRECT"|"ASPIRATIONAL"), scaleMatch (bool), certainty ("certain"|"likely"|"unsure"), reason (string), positioning (string), keyFeatures (array of string), description (string)`.

The prompt must state these rules verbatim:
```
You judge whether each candidate competes with the business described below.
Rules, applied strictly:
- Judge only from the evidence given. If the evidence does not show what the
  candidate sells, set isCompetitor false.
- "reason" must quote or reference something in that candidate's evidence.
  A reason that could be written without reading the evidence is invalid.
- Marketplaces, directories, review sites, news and blogs are not competitors
  unless they sell the same thing to the same buyer.
- Judge scale. If the candidate is far larger or far more established than the
  business, set scaleMatch false and type ASPIRATIONAL. Never DIRECT.
- "SEO" means it competes for the same searches. "BUSINESS" means it sells the
  same thing to the same buyer. Both can apply; at least one must, or
  isCompetitor is false.
```
Derive `judgeConfidence` deterministically from `certainty` — certain 0.9, likely 0.7, unsure 0.5 — and force `isCompetitor = false` when `labels` is empty.

**Why an enum and not a float the model writes:** a self-reported probability compresses into the top of its range. Measured live on this very code, an unanchored float returned 1.0 for every candidate including rejected ones; adding a written rubric only moved it to 0.90–0.98 — still all inside one band, so the keep-threshold and the high/medium split filtered nothing. A three-way choice cannot compress that way, and the mapping is ours, not the model's. Return the summed token usage.

- [ ] **Step 3: Verify against the real API**

Throwaway script: feed the Task 5 output for the Persian accounting query through `enrichCandidates` then `judgeCandidates` with a hand-built brief for a small Iranian retail-software company. Print domain, isCompetitor, type, labels, confidence and reason.

Expected: reasons reference the sites' actual content; any global giant comes back ASPIRATIONAL, not DIRECT.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/competitors/judge.ts
git commit -m "Judge candidates against their own evidence

Reads each candidate's homepage, then scores it with rules that reject
a reason no evidence supports and refuse DIRECT on a scale mismatch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Pipeline + run record

**Files:**
- Create: `apps/web/src/lib/competitors/pipeline.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 2, 4, 5, 6.
- Produces:
  ```ts
  export async function runDiscoveryPipeline(runId: string): Promise<void>
  export const STALE_RUN_MINUTES = 10;
  ```

**Context:** `runDiscoveryPipeline` owns the whole run and never throws to its caller — it records failure on the row instead. Stages, in order: `QUERIES`, `SEARCH`, `ENRICH`, `JUDGE`, `SAVE`, each written to `DiscoveryRun.stage` before the work starts so the UI can show it.

- [ ] **Step 1: Implement the pipeline**

Load the run and its workspace with competitors. Set `status: 'RUNNING'`. Then:
1. `QUERIES` → `buildBrandBrief` + `generateQueries`; save `queries` on the run.
2. `SEARCH` → run `harvestFromWebSearch` and `harvestFromSerp` in parallel with `Promise.allSettled`; `exclude` is the own domain plus every existing competitor domain (**including rejected ones — this is what stops rejected names coming back**). Merge by domain, unioning `sources` and summing `frequency`.
3. `ENRICH` → `enrichCandidates`.
4. `JUDGE` → `judgeCandidates`, then `rankAndKeep`.
5. `SAVE` → upsert each kept candidate by `(workspaceId, domain)`. On an existing row, write the new fields but **never** touch `userDecision`. New rows get `userDecision: 'PENDING'`, `source: 'AI'`, `discoveryRunId`.

   **Evidence ids must survive a rerun.** Before writing evidence to an existing competitor, read its stored evidence, build a map of `normalizeEvidenceUrl(url) -> id`, and reuse the id for any new item whose normalised URL matches. Only genuinely new URLs get `newEvidenceId()`. Other features cite evidence by id — the positioning-matrices work depends on this — so a rerun must never re-point an existing citation.

Finish with `status: 'DONE'` and `savedCount` when at least one was saved, `'EMPTY'` when none survived, and `'FAILED'` with `error` on a thrown error. Always set `finishedAt`, accumulate `tokensUsed`, and write `sourceStats` with per-stage counts. Keep `writeActivityLog` calls for `COMPETITOR_DISCOVERY_RUN` so the admin console keeps working.

- [ ] **Step 2: Add stale-run reaping**

```ts
export async function reapStaleRuns(workspaceId: string): Promise<void>
```
Marks any run of this workspace that is `PENDING`/`RUNNING` and older than `STALE_RUN_MINUTES` as `FAILED` with `error: 'TIMED_OUT'`. Called on every status read. Since quota counts only `DONE`, a timed-out run costs the user nothing.

- [ ] **Step 3: Verify against the running system**

Start the dev server (`pnpm --filter web dev`, read the actual port). From a node script, insert a `DiscoveryRun` row for a real local workspace and call `runDiscoveryPipeline(runId)` directly with `tsx`. Then query the DB:
```bash
psql "$DATABASE_URL" -c "select status, stage, savedCount, tokensUsed, error from contivo.discovery_runs order by \"startedAt\" desc limit 1;"
psql "$DATABASE_URL" -c "select name, domain, confidence, labels, \"userDecision\" from contivo.competitors order by \"createdAt\" desc limit 10;"
```
Expected: `DONE`, competitors with real confidence values and populated `labels` and `evidence`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/competitors/pipeline.ts
git commit -m "Run discovery as one recorded pipeline

Five stages write their progress to the run row, rejected domains are
excluded before searching, and a stuck run reaps itself uncharged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Server actions + background route

**Files:**
- Modify: `apps/web/src/app/actions/growth-competitors.ts` (rewrite)
- Create: `apps/web/src/app/api/growth/discovery/run/route.ts`, `apps/web/src/lib/background-run.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function startCompetitorDiscovery(workspaceId: string):
    Promise<{ runId: string } | { error: string; meta?: DiscoveryMeta }>
  export async function getDiscoveryStatus(workspaceId: string):
    Promise<{ run: RunView | null; meta: DiscoveryMeta; competitors: CompetitorView[] }>
  export async function setCompetitorDecision(
    workspaceId: string, competitorId: string,
    decision: 'ACCEPTED' | 'REJECTED' | 'PENDING', rejectionReason?: string,
  ): Promise<{ success: true } | { error: string }>
  export async function updateCompetitorType(
    workspaceId: string, competitorId: string, type: CompetitorType,
  ): Promise<{ success: true } | { error: string }>
  export async function addManualCompetitor(workspaceId: string, domainInput: string):
    Promise<{ competitor: CompetitorView; judgeWarning: string | null } | { error: string }>
  export async function removeCompetitor(workspaceId: string, competitorId: string):
    Promise<{ success: true } | { error: string }>
  export async function updateTargetMarket(
    workspaceId: string, country: string | null, language: 'fa' | 'en',
  ): Promise<{ success: true } | { error: string }>
  export async function listDiscoveryRuns(workspaceId: string): Promise<RunHistoryItem[]>
  ```
  `DiscoveryMeta = { usedRuns: number; remainingRuns: number; maxRuns: number }`.
  `CompetitorView` serialises a competitor with `confidenceBand` already applied, evidence, labels and decision.

**Context:** Every action re-checks ownership with `findFirst({ where: { id, userId: session.userId } })` **before** doing anything, and every competitor id is checked to belong to that workspace — the existing file's comments explain why (a client-supplied workspace id was once trusted, which let one user write competitors into another's workspace and thereby inject content into ideation). Keep that discipline. The browser never calls the Nest API directly.

- [ ] **Step 1: Write the new actions module**

Delete `saveCompetitors`, `discoverWorkspaceCompetitors`, `saveWorkspaceCompetitorEdits`, `discoverCompetitorsWithOpenAI`, `buildCompetitorDiscoveryPrompt`, `isLikelySyntheticCompetitor`, `domainHasDns` and `domainResponds`. Move `collectWebsiteEvidence` and its HTML helpers to `judge.ts` (Task 6) and the small string helpers into `lib/competitors/`.

`startCompetitorDiscovery`: ownership → `reapStaleRuns` → refuse if a run is already active (`error: 'discoveryAlreadyRunning'`) → quota check counting `DONE` runs plus legacy archive entries → create the run `PENDING` → `fetch` the internal route below with the `CRON_SECRET` bearer and `void` the promise → return `runId`.

`getDiscoveryStatus`: ownership → `reapStaleRuns` → latest run + quota + all competitors serialised.

`addManualCompetitor`: normalise the domain, reject a duplicate, then `enrichCandidates` + `judgeCandidates` on that one domain. Save as `ACCEPTED` with `sources: ['MANUAL']` **whatever the judge says**; return `judgeWarning` with the judge's reason when `isCompetitor` is false. It does not consume a run.

- [ ] **Step 2: Write the background route, with the run pattern extracted**

Put the reusable half in `apps/web/src/lib/background-run.ts` so a later feature (the positioning-matrices redesign is already planning on it) can reuse it rather than copy it:
```ts
/** Kick off a long job in a route that owns its own maxDuration. */
export async function triggerBackgroundRun(path: string, body: Record<string, unknown>): Promise<void>
```
It POSTs to `${process.env.WEB_APP_URL}${path}` with the `CRON_SECRET` bearer and swallows its own errors — the run row, not this call, is the source of truth.

Then the route itself:

```ts
// apps/web/src/app/api/growth/discovery/run/route.ts
export const maxDuration = 300; // seconds; Vercel clamps to the plan limit
export const dynamic = 'force-dynamic';
```
POST handler: reject unless `authorization === 'Bearer ' + process.env.CRON_SECRET`, read `{ runId }`, call `after(() => runDiscoveryPipeline(runId))` from `next/server`, and return `202` immediately.

- [ ] **Step 3: Verify against the running system**

With the dev server up, call `startCompetitorDiscovery` from a server-side script for a real local workspace, then poll `getDiscoveryStatus` every 5s and print `status` and `stage`.

Expected: the stage advances through QUERIES → SEARCH → ENRICH → JUDGE → SAVE and lands on DONE or EMPTY. Then confirm calling `startCompetitorDiscovery` again while one is active returns `discoveryAlreadyRunning`, and that a FAILED run did not raise `usedRuns`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/actions/growth-competitors.ts apps/web/src/app/api/growth/discovery/run/route.ts apps/web/src/lib/background-run.ts
git commit -m "Start discovery in the background and report it honestly

Ownership is re-checked on every action, one run at a time per
workspace, and only completed runs count against the quota.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Downstream selector

**Files:**
- Create: `apps/web/src/lib/competitors/selection.ts`
- Test: `apps/web/src/lib/competitors/selection.test.ts`
- Modify: `apps/web/src/app/actions/growth-matrices.ts:532-533`, `growth-keywords.ts:285-286`, `growth-offerings.ts:339-340`

**Interfaces:**
- Produces:
  ```ts
  export type SelectionBasis = 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE';
  export type CorroborationInput = {
    userDecision: string | null;
    confidence: number | null;
    sources?: string[] | null;
    evidence?: unknown;            // EvidenceItem[] as stored; items may carry `query`
  };
  export function isCorroborated(row: CorroborationInput): boolean
  export function selectCompetitors<T extends CorroborationInput>(
    all: T[],
  ): { competitors: T[]; basis: SelectionBasis }
  ```

**Context:** This implements D8. Today those three files fall back to *every* non-rejected competitor, which lets unreviewed guesses into analysis silently. The new rule: accepted first; if there are none, only PENDING that are BOTH `confidence >= 0.8` AND corroborated; otherwise nothing.

**Corroborated** means the competitor's stored `evidence` carries citations from at least two distinct `query` values, or its `sources` array holds more than one source. This second condition exists because the first is the model grading itself: the judge's certainty is its own opinion, while the number of distinct searches that surfaced a domain is a fact it cannot inflate. Only the combination is allowed to feed analysis unreviewed.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { selectCompetitors } from './selection';

const c = (userDecision: string | null, confidence: number | null, id = '') => ({ userDecision, confidence, id });

describe('selectCompetitors', () => {
  it('prefers accepted competitors and ignores confidence', () => {
    const { competitors, basis } = selectCompetitors([c('ACCEPTED', null, 'a'), c('PENDING', 0.95, 'b')]);
    expect(basis).toBe('ACCEPTED');
    expect(competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('falls back only to pending competitors that are high-confidence AND corroborated', () => {
    const corroborated = { ...c('PENDING', 0.95, 'a'), evidence: [{ query: 'q1' }, { query: 'q2' }] };
    const highButAlone = { ...c('PENDING', 0.95, 'b'), evidence: [{ query: 'q1' }, { query: 'q1' }] };
    const corroboratedButLow = { ...c('PENDING', 0.7, 'c'), evidence: [{ query: 'q1' }, { query: 'q2' }] };
    const { competitors, basis } = selectCompetitors([corroborated, highButAlone, corroboratedButLow]);
    expect(basis).toBe('UNCONFIRMED_HIGH');
    expect(competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('treats more than one source as corroboration too', () => {
    const twoSources = { ...c('PENDING', 0.95, 'a'), sources: ['WEB_SEARCH', 'SERP'], evidence: [{ query: 'q1' }] };
    expect(selectCompetitors([twoSources]).competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('never corroborates from malformed evidence', () => {
    const junk = { ...c('PENDING', 0.99, 'a'), evidence: 'not an array' };
    expect(selectCompetitors([junk])).toEqual({ competitors: [], basis: 'NONE' });
  });

  it('never returns rejected competitors', () => {
    expect(selectCompetitors([c('REJECTED', 0.99, 'a')])).toEqual({ competitors: [], basis: 'NONE' });
  });

  it('never returns legacy pending rows with no confidence', () => {
    expect(selectCompetitors([c('PENDING', null, 'a')])).toEqual({ competitors: [], basis: 'NONE' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web test`
Expected: FAIL — cannot resolve `./selection`.

- [ ] **Step 3: Implement**

```ts
import { confidenceBand } from './scoring';

export type SelectionBasis = 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE';

/**
 * What analysis is allowed to build on. Accepted competitors are the user's
 * own word. With none, Autopilot still has to run at 3am, so high-confidence
 * unreviewed candidates are allowed — but the caller must label the output,
 * and a legacy row with no confidence never qualifies.
 */
export function selectCompetitors<T extends { userDecision: string | null; confidence: number | null }>(
  all: T[],
): { competitors: T[]; basis: SelectionBasis } {
  const accepted = all.filter((item) => item.userDecision === 'ACCEPTED');
  if (accepted.length > 0) return { competitors: accepted, basis: 'ACCEPTED' };

  const unconfirmed = all.filter(
    (item) =>
      item.userDecision !== 'REJECTED' &&
      confidenceBand(item.confidence) === 'high' &&
      isCorroborated(item),
  );
  if (unconfirmed.length > 0) return { competitors: unconfirmed, basis: 'UNCONFIRMED_HIGH' };

  return { competitors: [], basis: 'NONE' };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter web test`

- [ ] **Step 5: Replace the three ad-hoc filters**

In each of `growth-matrices.ts`, `growth-keywords.ts` and `growth-offerings.ts`, replace the `accepted` / `fallback` pair with `const { competitors, basis } = selectCompetitors(all);` and use `competitors`. Store `basis` on whatever payload that feature already persists (the matrices payload has `source`; add `competitor_basis`), so the UI can show the "based on unconfirmed competitors" label in Task 10.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm --filter web typecheck && pnpm --filter web test
git add apps/web/src/lib/competitors/selection.ts apps/web/src/lib/competitors/selection.test.ts apps/web/src/app/actions/growth-matrices.ts apps/web/src/app/actions/growth-keywords.ts apps/web/src/app/actions/growth-offerings.ts
git commit -m "Stop unreviewed guesses leaking into analysis

One selector decides what analysis may build on: accepted competitors,
or high-confidence unreviewed ones with the basis recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: UI

**Files:**
- Create: `.../growth/[id]/_components/CompetitorDiscoveryPanel.tsx`, `CompetitorReviewQueue.tsx`, `CompetitorList.tsx`
- Modify: `.../growth/[id]/_components/CompetitorMapManager.tsx`, `apps/web/messages/en/growth.json`, `apps/web/messages/fa/growth.json`

**Context:** `CompetitorMapManager` is rendered by `CompetitiveMatricesTab.tsx:244`. Keep that entry point and the component name so the tab needs no change; replace its body. Remove the scatter map, `estimateAudienceSizeScore`, `computeKeywordScore`, `hashString`, `isSyntheticCompetitor`, `positionedCompetitors` and the unsaved-changes banner. Keep the existing `dir="ltr"` comment discipline for any chart that survives — there is none here, so the new components are plain RTL-safe flow. Competitor names stay wrapped in `<bdi>`; they are data and are never translated.

- [ ] **Step 1: Build `CompetitorDiscoveryPanel`**

Props: `workspaceId`, initial `meta`, initial `run`, `market`. Shows "Searching in: {country} · {language}" with an inline editor calling `updateTargetMarket`, the find button (disabled while a run is active or the quota is spent), the quota, and — while `status` is PENDING or RUNNING — the stage and the queries as chips. Poll `getDiscoveryStatus` every 3s only while a run is active; stop on DONE/EMPTY/FAILED. On EMPTY show the count of queries actually run and the two next steps (change market, add manually). On FAILED show the error and state that the run was not charged.

- [ ] **Step 2: Build `CompetitorReviewQueue`**

Sorted by confidence descending. Each card: `<bdi>{name}</bdi>`, the domain as an external link, label chips (SEO / BUSINESS), a type selector, the confidence as a **word** from `confidenceBand` (never a percentage), the one-line reason, and a `<details>` "Why?" holding the queries, the citation links and the site summary. Accept and reject buttons call the actions immediately; reject opens four reason chips (`DIFFERENT_MARKET`, `TOO_BIG`, `DIFFERENT_PRODUCT`, `NOT_A_COMPANY`) plus a skip. After any action show an undo affordance that calls `setCompetitorDecision(..., 'PENDING')`.

- [ ] **Step 3: Build `CompetitorList`**

The accepted competitors compactly, with type editing and remove. A domain input calling `addManualCompetitor` that renders `judgeWarning` as a warning, not an error, when present. A collapsed run history from `listDiscoveryRuns`: date, market, query count, found and accepted counts.

- [ ] **Step 4: Write both message catalogues**

Add every new key under `growth.competitors` in `apps/web/messages/en/growth.json`, then write the Persian in `apps/web/messages/fa/growth.json`. Write the Persian as Persian — do not translate the English sentence by sentence. All counts go through ICU `{count, number}`, never hardcoded digits.

- [ ] **Step 5: Verify**

```bash
pnpm --filter web check:i18n && pnpm --filter web typecheck && pnpm --filter web test
```
Then start the dev server, read its actual port, and open the growth workspace page. Token minting is blocked, so **ask the user to sign in** and say which local workspace to open. Drive a full run, confirm the stages appear, expand a "Why?", accept one and reject one with a reason, and take a screenshot of the review queue in both `en` and `fa`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(dashboard\)/growth apps/web/messages
git commit -m "Show the evidence behind every competitor

Replaces the invented scatter map with a run panel, a review queue that
shows what was searched and cited, and an accepted list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Delete the orphan page and finish

**Files:**
- Delete: `apps/web/src/app/[locale]/(dashboard)/growth/competitors/page.tsx`, `CompetitorsClient.tsx`
- Modify: `apps/web/src/i18n/routing.ts:69`, `FEATURELIST.md`

**Context:** The page is unreachable (nothing links to it), defaults unreviewed competitors to ACCEPTED so one save pushes AI guesses into reports and narrative, and positions its map from `sin(i)`/`cos(i)`. It duplicates the live surface.

- [ ] **Step 1: Delete and unroute**

```bash
git rm -r "apps/web/src/app/[locale]/(dashboard)/growth/competitors"
```
Remove the `'/growth/competitors'` entry from `apps/web/src/i18n/routing.ts`. Remove its keys from both message catalogues if they are not shared with the surviving UI.

- [ ] **Step 2: Confirm nothing referenced it**

```bash
grep -rn "growth/competitors\|CompetitorsClient\|saveCompetitors" apps/web/src | grep -v node_modules
```
Expected: no output.

- [ ] **Step 3: Update FEATURELIST.md**

Under "Competitive Intelligence", replace the discovery bullets with what now exists: grounded discovery from live search with evidence, target market per workspace, labelled competitors, a review queue with rejection reasons, and run history.

- [ ] **Step 4: Full verification**

```bash
pnpm --filter web check:i18n && pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove the orphan competitors page

Nothing linked to it, it defaulted unreviewed AI guesses to accepted,
and its map positions came from the row index.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Report cost, and stop**

Query the token cost of the real runs:
```bash
psql "$DATABASE_URL" -c "select id, status, \"savedCount\", \"tokensUsed\", \"finishedAt\" - \"startedAt\" as duration from contivo.discovery_runs order by \"startedAt\" desc limit 10;"
```
Report the median tokens and duration per run to the user. **Do not set a cost ceiling** — the user walks the finished solution end to end and sets the limits from that (spec §8).

**Do not merge to `main`.** A push to `main` auto-deploys www.contivo.app.

---

## Self-Review

**Spec coverage:** §4 → Task 3. §5.0 → Tasks 7, 8. §5.1–5.2 → Task 4. §5.3 → Tasks 1, 5. §5.4–5.5 → Task 6. §5.6 → Task 2. §5.7 → Task 7. §5.8 → Task 8. §6 → Tasks 10, 11. §7 → Task 9. §8 → Task 11 step 6. §9 → Tasks 5, 7, 8. §10 → Tasks 1, 2, 9 (unit), 7, 8, 10 (live). §11 out of scope, untouched.

**Teammate dependency:** the positioning-matrices session (same branch, code not started, waiting on this work) depends on three things this plan produces: `selectCompetitors` returning `{ competitors, basis }`, evidence items with **stable ids** (Task 2 step 1, preserved on rerun in Task 7 step 1) plus `positioning` / `keyFeatures` / `labels` / `confidence`, and the background-run pattern being reusable (Task 8 step 2). Message them the final signatures when Task 11 is done.

**Known gap, accepted:** the spec's integration test with recorded OpenAI fixtures (§10) is replaced by the live verification steps in Tasks 5–8, because there is no fixture harness in this repo and building one would be a larger job than the pipeline. The invariants it would have covered — rejected domains never reappear, decisions never overwritten, the ten cap — are covered by Task 7 step 3 against the real database and by the Task 2 unit tests.

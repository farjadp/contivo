/**
 * comparison.ts — the facts behind /compare.
 *
 * Contivo is compared with categories of tools, not head to head with named
 * vendors. Named examples appear only where the fact was read on the vendor's
 * own page, on the date in CHECKED_ON, and every such page is in SOURCES.
 * Research memo: .claude/agent-org/work/growth/2026-11-22-comparison-research.md
 *
 * The copy for every cell lives in the `compare` message namespace under
 * `compare.rows.<row>.<column>`; only the status lives here, so the table's
 * shape cannot drift between languages.
 *
 * Rules the page keeps (from the research):
 *   - No "better writing" claim: the models underneath are the same class.
 *   - "Not listed" is not "no": a vendor that does not list a feature gets
 *     `unlisted`, never `no`.
 *   - Keyword gaps are not headlined until production data is proven.
 */

export const CHECKED_ON = '2026-11-22';

export type Column = 'contivo' | 'writers' | 'schedulers' | 'seo' | 'assistants' | 'agents';
export type Status = 'yes' | 'partial' | 'no' | 'unlisted';

export const COLUMNS: readonly Column[] = ['contivo', 'writers', 'schedulers', 'seo', 'assistants', 'agents'];

export type RowId =
  | 'competitors'
  | 'lock'
  | 'storyline'
  | 'factGate'
  | 'autopilot'
  | 'social'
  | 'ownSite'
  | 'persian'
  | 'languages'
  | 'analytics'
  | 'price';

export const ROWS: ReadonlyArray<{ id: RowId; status: Record<Column, Status | null> }> = [
  {
    id: 'competitors',
    status: { contivo: 'yes', writers: 'unlisted', schedulers: 'partial', seo: 'partial', assistants: 'partial', agents: 'partial' },
  },
  {
    id: 'lock',
    status: { contivo: 'yes', writers: 'no', schedulers: 'no', seo: 'no', assistants: 'no', agents: 'partial' },
  },
  {
    id: 'storyline',
    status: { contivo: 'yes', writers: 'partial', schedulers: 'partial', seo: 'partial', assistants: 'partial', agents: 'partial' },
  },
  {
    id: 'factGate',
    status: { contivo: 'yes', writers: 'partial', schedulers: 'unlisted', seo: 'unlisted', assistants: 'no', agents: 'no' },
  },
  {
    id: 'autopilot',
    status: { contivo: 'yes', writers: 'unlisted', schedulers: 'yes', seo: 'no', assistants: 'partial', agents: 'yes' },
  },
  {
    id: 'social',
    status: { contivo: 'partial', writers: 'no', schedulers: 'yes', seo: 'no', assistants: 'no', agents: 'partial' },
  },
  {
    id: 'ownSite',
    status: { contivo: 'yes', writers: 'partial', schedulers: 'partial', seo: 'yes', assistants: 'no', agents: 'partial' },
  },
  {
    id: 'persian',
    status: { contivo: 'yes', writers: 'partial', schedulers: 'unlisted', seo: 'unlisted', assistants: 'yes', agents: 'partial' },
  },
  {
    id: 'languages',
    status: { contivo: 'partial', writers: 'yes', schedulers: 'partial', seo: 'yes', assistants: 'yes', agents: 'yes' },
  },
  {
    id: 'analytics',
    status: { contivo: 'no', writers: 'partial', schedulers: 'yes', seo: 'yes', assistants: 'no', agents: 'partial' },
  },
  // Prices are plain text, not a verdict.
  {
    id: 'price',
    status: { contivo: null, writers: null, schedulers: null, seo: null, assistants: null, agents: null },
  },
];

/** What only Contivo does, in the order a customer meets it. Copy: `compare.unique.<id>`. */
export const UNIQUE = ['lock', 'scale', 'storyline', 'gate', 'ownSite', 'persian'] as const;

/** Where it is behind. Copy: `compare.behind.<id>`. */
export const BEHIND = ['channels', 'languages', 'analytics', 'monitoring', 'estimates', 'early', 'price'] as const;

/** Honest pointers elsewhere. Copy: `compare.elsewhere.<id>`. */
export const ELSEWHERE = ['channels', 'languages', 'search', 'build', 'time'] as const;

/** Vendor pages the named facts were read on, on CHECKED_ON. */
export const SOURCES: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'Jasper — pricing', url: 'https://www.jasper.ai/pricing' },
  { name: 'Jasper — languages', url: 'https://www.jasper.ai/languages' },
  { name: 'Copy.ai — pricing', url: 'https://www.copy.ai/prices' },
  { name: 'Writesonic — pricing', url: 'https://writesonic.com/pricing' },
  { name: 'Anyword — pricing', url: 'https://anyword.com/pricing' },
  { name: 'Buffer — pricing', url: 'https://buffer.com/pricing' },
  { name: 'Hootsuite — plans', url: 'https://www.hootsuite.com/plans' },
  { name: 'Later — pricing', url: 'https://later.com/pricing/' },
  { name: 'Ocoya — pricing', url: 'https://www.ocoya.com/pricing' },
  { name: 'Surfer — pricing', url: 'https://surfer.ai/pricing/' },
  { name: 'Semrush Content Toolkit — pricing and limits', url: 'https://www.semrush.com/kb/1536-content-toolkit-pricing-and-limits' },
  { name: 'ChatGPT Plus', url: 'https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus' },
  { name: 'Claude — pricing', url: 'https://claude.com/pricing' },
  { name: 'OpenAI — ChatGPT Work', url: 'https://openai.com/index/chatgpt-for-your-most-ambitious-work/' },
  { name: 'Manus — membership pricing', url: 'https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus' },
  { name: 'Manus — Buffer connector', url: 'https://manus.im/connectors/buffer' },
  { name: 'Zapier — pricing', url: 'https://zapier.com/pricing' },
  { name: 'n8n — pricing', url: 'https://n8n.io/pricing/' },
];

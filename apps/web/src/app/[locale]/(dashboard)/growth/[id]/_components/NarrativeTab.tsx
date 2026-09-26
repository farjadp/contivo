'use client';

/**
 * Narrative — where a workspace gets a position.
 *
 * Two things Contivo cannot derive: the change happening in the customer's
 * world, and what this company can actually prove. Everything else is drafted
 * from intelligence already on the shelf. Rejecting a proposed change is given
 * the same weight as accepting one, because a wrongly guessed change tilts
 * every storyline hanging off it.
 */

import { useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Loader2, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react';

import {
  addEvidence,
  deleteEvidence,
  generateStorylines,
  proposeChange,
  setChange,
  updateStoryline,
} from '@/app/actions/narrative';

type Evidence = { id: string; kind: string; value: string; detail: string | null };
type Storyline = {
  id: string;
  claim: string;
  audience: string | null;
  winners: string | null;
  losers: string | null;
  promisedLand: string;
  gifts: unknown;
  sourceRefs: unknown;
  enabled: boolean;
};
type Narrative = {
  id: string;
  change: string | null;
  changeSource: string;
  changeOptions: unknown;
  generatedBy: string | null;
  generatedAt: string | Date | null;
  storylines: Storyline[];
} | null;

/* The stored enum values; their labels come from the catalogue so the
   dropdown and the list read in the visitor's language. */
const EVIDENCE_KINDS = [
  'CUSTOMER_COUNT',
  'PUBLIC_NUMBER',
  'NAMED_CUSTOMER',
  'FIRSTHAND_EXPERIENCE',
  'FORBIDDEN_CLAIM',
] as const;

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export function NarrativeTab({
  workspaceId,
  narrative,
  evidence,
}: {
  workspaceId: string;
  narrative: Narrative;
  evidence: Evidence[];
}) {
  const t = useTranslations('tabsB.narrative');
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /**
   * The proposals stay in the database after one is accepted, so loading the
   * page again would otherwise show the alternatives sitting beside the answer
   * as though nothing had been decided. Once there is an agreed change the
   * question is closed; "Propose again" is how it reopens.
   */
  const [options, setOptions] = useState(
    narrative?.change ? [] : asChangeOptions(narrative?.changeOptions),
  );
  const [draftChange, setDraftChange] = useState(narrative?.change ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  const storylines = narrative?.storylines ?? [];

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(label);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? t('genericError'));
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <h2 className="font-display text-[22px] font-bold text-moss">{t('title')}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-moss-muted">{t('subtitle')}</p>
      </header>

      {error && (
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-[13.5px] text-moss">{error}</p>
        </div>
      )}

      {/* ── Step 1 · The change ─────────────────────────────────── */}
      <section className="border border-rule bg-chalk-raised p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-[17px] font-semibold text-moss">
            {t('change.heading')}
          </h3>
          {narrative?.change && (
            <span className="text-[12px] text-moss-muted">
              {narrative.changeSource === 'HUMAN'
                ? t('change.sourceHuman')
                : narrative.changeSource === 'EDITED'
                  ? t('change.sourceEdited')
                  : t('change.sourceProposed')}
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-moss-muted">
          {t('change.help')}
        </p>

        {options.length > 0 && (
          <ul className="mt-5 space-y-3">
            {options.map((o, i) => (
              <li key={i} className="border border-rule p-4">
                <p className="text-[14.5px] leading-relaxed text-moss">{o.change}</p>
                {o.rationale && (
                  <p className="mt-2 text-[13px] leading-relaxed text-moss-muted">{o.rationale}</p>
                )}
                {o.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {o.evidence.map((e, j) => (
                      <li key={j} className="text-[12px] leading-relaxed text-moss-muted">
                        · {e}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      run('accept', async () => {
                        const res = await setChange(workspaceId, o.change, 'PROPOSED');
                        // The save always worked; nothing moved on screen. The
                        // label above and step 3 below are driven by the server
                        // prop and do update, but the list being looked at is
                        // local state, so accepting appeared to do nothing.
                        if (res.ok) {
                          setOptions([]);
                          setDraftChange(o.change);
                        }
                        return res;
                      })
                    }
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 bg-moss px-3 py-1.5 text-[12.5px] font-medium text-chalk hover:bg-moss-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> {t('change.useThis')}
                  </button>
                  <button
                    onClick={() => setDraftChange(o.change)}
                    className="inline-flex items-center gap-1.5 border border-rule-strong px-3 py-1.5 text-[12.5px] text-moss-muted hover:border-rule-strong"
                  >
                    <Pencil className="h-3.5 w-3.5" /> {t('change.editIt')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <label htmlFor="change" className="text-[12.5px] font-medium text-moss-muted">
            {options.length > 0 ? t('change.labelOwn') : t('change.label')}
          </label>
          <textarea
            id="change"
            rows={2}
            value={draftChange}
            onChange={(e) => setDraftChange(e.target.value)}
            placeholder={t('change.placeholder')}
            className="mt-2 w-full resize-y border border-rule-strong bg-chalk-raised px-3 py-2.5 text-[14px] text-moss outline-none focus:border-moss"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() =>
                run('save-change', async () => {
                  const source =
                    narrative?.change === draftChange
                      ? 'PROPOSED'
                      : options.length
                        ? 'EDITED'
                        : 'HUMAN';
                  const res = await setChange(workspaceId, draftChange, source);
                  // Same reason as accepting: close the question visibly.
                  if (res.ok) setOptions([]);
                  return res;
                })
              }
              disabled={pending || draftChange.trim().length < 10}
              className="inline-flex items-center gap-2 bg-moss px-4 py-2 text-[13px] font-medium text-chalk hover:bg-moss-700 disabled:opacity-40"
            >
              {busy === 'save-change' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('change.save')}
            </button>
            <button
              onClick={() =>
                run('propose', async () => {
                  const res = await proposeChange(workspaceId);
                  if (res.ok) setOptions(res.options);
                  return res;
                })
              }
              disabled={pending}
              className="inline-flex items-center gap-2 border border-rule-strong px-4 py-2 text-[13px] text-moss-muted hover:border-rule-strong disabled:opacity-40"
            >
              {busy === 'propose' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {options.length ? t('change.proposeAgain') : t('change.propose')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Step 2 · Evidence ───────────────────────────────────── */}
      <EvidenceSection workspaceId={workspaceId} evidence={evidence} run={run} pending={pending} />

      {/* ── Step 3 · Storylines ─────────────────────────────────── */}
      <section className="border border-rule bg-chalk-raised p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-[17px] font-semibold text-moss">
            {t('storylines.heading')}
          </h3>
          {narrative?.generatedBy && (
            <span className="text-[12px] text-moss-muted">
              {/* The model name is a product name: it stays Latin and is
                  isolated so the Persian around it keeps its own direction. */}
              {t.rich('storylines.draftedBy', {
                model: narrative.generatedBy,
                m: (chunks) => <bdi>{chunks}</bdi>,
              })}
            </span>
          )}
        </div>

        {storylines.length === 0 ? (
          <p className="mt-2 text-[13.5px] text-moss-muted">
            {narrative?.change ? t('storylines.emptyDrafted') : t('storylines.emptyNoChange')}
          </p>
        ) : (
          <ul className="mt-5 space-y-5">
            {storylines.map((s, i) => (
              <StorylineCard
                key={s.id}
                workspaceId={workspaceId}
                storyline={s}
                order={format.number(i + 1, { minimumIntegerDigits: 2 })}
                run={run}
                pending={pending}
              />
            ))}
          </ul>
        )}

        <button
          onClick={() => run('storylines', () => generateStorylines(workspaceId))}
          disabled={pending || !narrative?.change}
          className="mt-6 inline-flex items-center gap-2 bg-moss px-4 py-2.5 text-[13px] font-medium text-chalk hover:bg-moss-700 disabled:opacity-40"
        >
          {busy === 'storylines' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {storylines.length ? t('storylines.draftAgain') : t('storylines.draft')}
        </button>
        {storylines.length > 0 && (
          <p className="mt-2 text-[12px] text-moss-muted">{t('storylines.redraftWarning')}</p>
        )}
      </section>
    </div>
  );
}

function asChangeOptions(v: unknown): Array<{ change: string; rationale: string; evidence: string[] }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o: any) => o && typeof o.change === 'string')
    .map((o: any) => ({
      change: String(o.change),
      rationale: String(o.rationale ?? ''),
      evidence: asArray(o.evidence),
    }));
}

function EvidenceSection({
  workspaceId,
  evidence,
  run,
  pending,
}: {
  workspaceId: string;
  evidence: Evidence[];
  run: (l: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  pending: boolean;
}) {
  const t = useTranslations('tabsB.narrative.evidence');
  const [kind, setKind] = useState('FIRSTHAND_EXPERIENCE');
  const [value, setValue] = useState('');

  const kindLabel = (k: string) =>
    (EVIDENCE_KINDS as readonly string[]).includes(k)
      ? t(`kinds.${k as (typeof EVIDENCE_KINDS)[number]}`)
      : k;

  return (
    <section className="border border-rule bg-chalk-raised p-6">
      <h3 className="font-display text-[17px] font-semibold text-moss">{t('heading')}</h3>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-moss-muted">{t('help')}</p>

      {evidence.length > 0 && (
        <ul className="mt-5 divide-y divide-rule border-y border-rule">
          {evidence.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[11.5px] uppercase tracking-wide text-moss-muted">
                  {kindLabel(e.kind)}
                </p>
                <p className="mt-0.5 text-[14px] text-moss">{e.value}</p>
              </div>
              <button
                onClick={() => run('del', () => deleteEvidence(workspaceId, e.id))}
                disabled={pending}
                aria-label={t('remove')}
                className="shrink-0 p-1.5 text-moss-muted hover:text-moss disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ekind" className="text-[12.5px] font-medium text-moss-muted">
            {t('typeLabel')}
          </label>
          <select
            id="ekind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1.5 block border border-rule-strong bg-chalk-raised px-3 py-2 text-[13.5px] text-moss outline-none focus:border-moss"
          >
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="evalue" className="text-[12.5px] font-medium text-moss-muted">
            {t('valueLabel')}
          </label>
          <input
            id="evalue"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('valuePlaceholder')}
            className="mt-1.5 w-full border border-rule-strong bg-chalk-raised px-3 py-2 text-[13.5px] text-moss outline-none focus:border-moss"
          />
        </div>
        <button
          onClick={() =>
            run('add-ev', async () => {
              const res = await addEvidence(workspaceId, { kind, value });
              if (res.ok) setValue('');
              return res;
            })
          }
          disabled={pending || value.trim().length < 2}
          className="border border-rule-strong px-4 py-2 text-[13px] text-moss-muted hover:border-rule-strong disabled:opacity-40"
        >
          {t('add')}
        </button>
      </div>
    </section>
  );
}

function StorylineCard({
  workspaceId,
  storyline,
  order,
  run,
  pending,
}: {
  workspaceId: string;
  storyline: Storyline;
  /** Already formatted, so Persian shows «۰۱» rather than «01». */
  order: string;
  run: (l: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  pending: boolean;
}) {
  const t = useTranslations('tabsB.narrative.storylines');
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState(storyline.claim);
  const gifts = asArray(storyline.gifts);
  const refs = asArray(storyline.sourceRefs);

  return (
    <li className="border border-rule p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="mt-1 shrink-0 text-[12px] text-moss-muted">{order}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              rows={2}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              className="w-full resize-y border border-rule-strong px-3 py-2 text-[15px] text-moss outline-none focus:border-moss"
            />
          ) : (
            <p className="text-[15.5px] font-medium leading-snug text-moss">{storyline.claim}</p>
          )}

          {storyline.audience && (
            <p className="mt-2 text-[13px] text-moss-muted">
              <span className="text-moss-muted">{t('for')}</span> {storyline.audience}
            </p>
          )}

          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label={t('promisedLand')} value={storyline.promisedLand} />
            {storyline.winners && <Field label={t('wins')} value={storyline.winners} />}
            {storyline.losers && <Field label={t('loses')} value={storyline.losers} />}
            {gifts.length > 0 && <Field label={t('how')} value={gifts.join(' · ')} />}
          </dl>

          {refs.length > 0 && (
            <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-moss-muted">
              <span className="text-moss-muted">{t('builtFrom')}</span>{' '}
              {/* Source references are stored identifiers, not prose. */}
              <bdi>{refs.join(' · ')}</bdi>
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {editing ? (
              <>
                <button
                  onClick={() =>
                    run('save-storyline', async () => {
                      const res = await updateStoryline(workspaceId, storyline.id, { claim });
                      if (res.ok) setEditing(false);
                      return res;
                    })
                  }
                  disabled={pending}
                  className="bg-moss px-3 py-1.5 text-[12.5px] font-medium text-chalk hover:bg-moss-700 disabled:opacity-40"
                >
                  {t('save')}
                </button>
                <button
                  onClick={() => {
                    setClaim(storyline.claim);
                    setEditing(false);
                  }}
                  className="border border-rule-strong px-3 py-1.5 text-[12.5px] text-moss-muted hover:border-rule-strong"
                >
                  {t('cancel')}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 border border-rule-strong px-3 py-1.5 text-[12.5px] text-moss-muted hover:border-rule-strong"
              >
                <Pencil className="h-3.5 w-3.5" /> {t('editClaim')}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] uppercase tracking-wide text-moss-muted">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] leading-relaxed text-moss">{value}</dd>
    </div>
  );
}

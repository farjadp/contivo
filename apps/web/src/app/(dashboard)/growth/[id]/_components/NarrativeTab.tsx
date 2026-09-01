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

const EVIDENCE_LABELS: Record<string, string> = {
  CUSTOMER_COUNT: 'Customers',
  PUBLIC_NUMBER: 'A number you can state',
  NAMED_CUSTOMER: 'A customer you may name',
  FIRSTHAND_EXPERIENCE: 'Your own experience',
  FORBIDDEN_CLAIM: 'Never claim this',
};

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState(asChangeOptions(narrative?.changeOptions));
  const [draftChange, setDraftChange] = useState(narrative?.change ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  const storylines = narrative?.storylines ?? [];

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(label);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? 'Something went wrong.');
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <h2 className="font-display text-[22px] font-bold text-ink-900">Narrative</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
          Three or four arguments this company makes for months, so its content adds up
          instead of being forty unrelated posts. Drafted from your competitors, charts and
          brand memory — then corrected by you.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-[13.5px] text-ink-800">{error}</p>
        </div>
      )}

      {/* ── Step 1 · The change ─────────────────────────────────── */}
      <section className="border border-ink-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-[17px] font-semibold text-ink-900">
            1 · What is changing in your customers&apos; world?
          </h3>
          {narrative?.change && (
            <span className="text-[12px] text-ink-500">
              {narrative.changeSource === 'HUMAN'
                ? 'you wrote this'
                : narrative.changeSource === 'EDITED'
                  ? 'you edited our proposal'
                  : 'accepted from a proposal'}
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">
          Every storyline hangs off this one sentence, so it is worth disagreeing with us.
          It is about your customers&apos; world, not about your product.
        </p>

        {options.length > 0 && (
          <ul className="mt-5 space-y-3">
            {options.map((o, i) => (
              <li key={i} className="border border-ink-200 p-4">
                <p className="text-[14.5px] leading-relaxed text-ink-900">{o.change}</p>
                {o.rationale && (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-600">{o.rationale}</p>
                )}
                {o.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {o.evidence.map((e, j) => (
                      <li key={j} className="text-[12px] leading-relaxed text-ink-500">
                        — {e}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => run('accept', () => setChange(workspaceId, o.change, 'PROPOSED'))}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 bg-ink-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Use this
                  </button>
                  <button
                    onClick={() => setDraftChange(o.change)}
                    className="inline-flex items-center gap-1.5 border border-ink-300 px-3 py-1.5 text-[12.5px] text-ink-700 hover:border-ink-500"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit it
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <label htmlFor="change" className="text-[12.5px] font-medium text-ink-700">
            {options.length > 0 ? 'None of these — write your own' : 'The change'}
          </label>
          <textarea
            id="change"
            rows={2}
            value={draftChange}
            onChange={(e) => setDraftChange(e.target.value)}
            placeholder="Buyers in our market have stopped…"
            className="mt-2 w-full resize-y border border-ink-300 bg-white px-3 py-2.5 text-[14px] text-ink-900 outline-none focus:border-ink-900"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() =>
                run('save-change', () =>
                  setChange(
                    workspaceId,
                    draftChange,
                    narrative?.change === draftChange ? 'PROPOSED' : options.length ? 'EDITED' : 'HUMAN',
                  ),
                )
              }
              disabled={pending || draftChange.trim().length < 10}
              className="inline-flex items-center gap-2 bg-ink-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {busy === 'save-change' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save the change
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
              className="inline-flex items-center gap-2 border border-ink-300 px-4 py-2 text-[13px] text-ink-700 hover:border-ink-500 disabled:opacity-40"
            >
              {busy === 'propose' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {options.length ? 'Propose again' : 'Propose from my data'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Step 2 · Evidence ───────────────────────────────────── */}
      <EvidenceSection workspaceId={workspaceId} evidence={evidence} run={run} pending={pending} />

      {/* ── Step 3 · Storylines ─────────────────────────────────── */}
      <section className="border border-ink-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-[17px] font-semibold text-ink-900">3 · Your storylines</h3>
          {narrative?.generatedBy && (
            <span className="text-[12px] text-ink-500">drafted by {narrative.generatedBy}</span>
          )}
        </div>

        {storylines.length === 0 ? (
          <p className="mt-2 text-[13.5px] text-ink-600">
            {narrative?.change
              ? 'Nothing drafted yet.'
              : 'Agree on the change first — every storyline hangs off it.'}
          </p>
        ) : (
          <ul className="mt-5 space-y-5">
            {storylines.map((s, i) => (
              <StorylineCard key={s.id} workspaceId={workspaceId} storyline={s} index={i} run={run} pending={pending} />
            ))}
          </ul>
        )}

        <button
          onClick={() => run('storylines', () => generateStorylines(workspaceId))}
          disabled={pending || !narrative?.change}
          className="mt-6 inline-flex items-center gap-2 bg-ink-900 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {busy === 'storylines' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {storylines.length ? 'Draft them again' : 'Draft my storylines'}
        </button>
        {storylines.length > 0 && (
          <p className="mt-2 text-[12px] text-ink-500">Redrafting replaces all of them.</p>
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
  const [kind, setKind] = useState('FIRSTHAND_EXPERIENCE');
  const [value, setValue] = useState('');

  return (
    <section className="border border-ink-200 bg-white p-6">
      <h3 className="font-display text-[17px] font-semibold text-ink-900">
        2 · What can you actually prove?
      </h3>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">
        A storyline may only promise what you can back. Leave this empty and your storylines
        stay at the level of argument — which is honest, and still publishes. Claim something
        you cannot support and the quality gate will reject every draft that leans on it.
      </p>

      {evidence.length > 0 && (
        <ul className="mt-5 divide-y divide-ink-200 border-y border-ink-200">
          {evidence.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[11.5px] uppercase tracking-wide text-ink-500">
                  {EVIDENCE_LABELS[e.kind] ?? e.kind}
                </p>
                <p className="mt-0.5 text-[14px] text-ink-900">{e.value}</p>
              </div>
              <button
                onClick={() => run('del', () => deleteEvidence(workspaceId, e.id))}
                disabled={pending}
                aria-label="Remove"
                className="shrink-0 p-1.5 text-ink-400 hover:text-ink-900 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ekind" className="text-[12.5px] font-medium text-ink-700">
            Type
          </label>
          <select
            id="ekind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1.5 block border border-ink-300 bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none focus:border-ink-900"
          >
            {Object.entries(EVIDENCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="evalue" className="text-[12.5px] font-medium text-ink-700">
            What is it?
          </label>
          <input
            id="evalue"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="I ran support at a 40-person SaaS for three years"
            className="mt-1.5 w-full border border-ink-300 bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none focus:border-ink-900"
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
          className="border border-ink-300 px-4 py-2 text-[13px] text-ink-700 hover:border-ink-500 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function StorylineCard({
  workspaceId,
  storyline,
  index,
  run,
  pending,
}: {
  workspaceId: string;
  storyline: Storyline;
  index: number;
  run: (l: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState(storyline.claim);
  const gifts = asArray(storyline.gifts);
  const refs = asArray(storyline.sourceRefs);

  return (
    <li className="border border-ink-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="mt-1 shrink-0 text-[12px] text-ink-400">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              rows={2}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              className="w-full resize-y border border-ink-300 px-3 py-2 text-[15px] text-ink-900 outline-none focus:border-ink-900"
            />
          ) : (
            <p className="text-[15.5px] font-medium leading-snug text-ink-900">{storyline.claim}</p>
          )}

          {storyline.audience && (
            <p className="mt-2 text-[13px] text-ink-600">
              <span className="text-ink-400">For</span> {storyline.audience}
            </p>
          )}

          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Promised land" value={storyline.promisedLand} />
            {storyline.winners && <Field label="Wins" value={storyline.winners} />}
            {storyline.losers && <Field label="Loses" value={storyline.losers} />}
            {gifts.length > 0 && <Field label="How" value={gifts.join(' · ')} />}
          </dl>

          {refs.length > 0 && (
            <p className="mt-4 border-t border-ink-200 pt-3 text-[12px] leading-relaxed text-ink-500">
              <span className="text-ink-400">Built from</span> {refs.join(' · ')}
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
                  className="bg-ink-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setClaim(storyline.claim);
                    setEditing(false);
                  }}
                  className="border border-ink-300 px-3 py-1.5 text-[12.5px] text-ink-700 hover:border-ink-500"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 border border-ink-300 px-3 py-1.5 text-[12.5px] text-ink-700 hover:border-ink-500"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit the claim
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
      <dt className="text-[11.5px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] leading-relaxed text-ink-800">{value}</dd>
    </div>
  );
}

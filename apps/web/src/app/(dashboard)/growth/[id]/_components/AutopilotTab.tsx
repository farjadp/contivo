'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronUp, Play, Save, Zap } from 'lucide-react';

import {
  runAutopilotNow,
  saveAutopilotPolicy,
  type AutopilotPolicyInput,
  type SerializedPolicy,
  type SerializedRun,
} from '@/app/actions/autopilot';
import { CHANNEL_LABELS, CHANNEL_TO_PLATFORM, PUBLISHABLE_CHANNELS } from '@/lib/autopilot/channels';

type Props = {
  workspaceId: string;
  initialPolicy: SerializedPolicy | null;
  initialRuns: SerializedRun[];
  connectedPlatforms: Array<{ platform: string; accountName: string }>;
  ideationReady: boolean;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_FORM: AutopilotPolicyInput = {
  enabled: false,
  postsPerWeek: 3,
  channels: ['linkedin'],
  timezone: 'America/Toronto',
  windowStartHour: 9,
  windowEndHour: 18,
  publishDays: [1, 2, 3, 4, 5],
  goal: 'authority',
  topicHints: [],
  avoidTopics: [],
};

function toForm(p: SerializedPolicy | null): AutopilotPolicyInput {
  if (!p) return DEFAULT_FORM;
  return {
    enabled: p.enabled,
    postsPerWeek: p.postsPerWeek,
    channels: p.channels,
    timezone: p.timezone,
    windowStartHour: p.windowStartHour,
    windowEndHour: p.windowEndHour,
    publishDays: p.publishDays,
    goal: p.goal ?? '',
    topicHints: p.topicHints,
    avoidTopics: p.avoidTopics,
  };
}

export function AutopilotTab({
  workspaceId,
  initialPolicy,
  initialRuns,
  connectedPlatforms,
  ideationReady,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<AutopilotPolicyInput>(() => toForm(initialPolicy));
  // Server props win after router.refresh(); local override only right after a save.
  const [savedPolicy, setSavedPolicy] = useState<SerializedPolicy | null>(null);
  const policy = savedPolicy ?? initialPolicy;
  const runs = initialRuns; // refreshed via router.refresh() after save/run
  const [hintsText, setHintsText] = useState(initialPolicy?.topicHints.join(', ') ?? '');
  const [avoidText, setAvoidText] = useState(initialPolicy?.avoidTopics.join(', ') ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isRunning, startRun] = useTransition();

  const connectedSet = new Set(connectedPlatforms.map((c) => c.platform));
  const channelIsConnected = (channel: string) => {
    const platform = CHANNEL_TO_PLATFORM[channel as keyof typeof CHANNEL_TO_PLATFORM];
    return platform ? connectedSet.has(platform) : false;
  };
  const anyChannelConnected = form.channels.some(channelIsConnected);

  const splitList = (text: string) =>
    text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = () => {
    setMessage(null);
    startSave(async () => {
      const result = await saveAutopilotPolicy(workspaceId, {
        ...form,
        topicHints: splitList(hintsText),
        avoidTopics: splitList(avoidText),
      });
      if ('error' in result && result.error) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if ('policy' in result && result.policy) {
        setSavedPolicy(result.policy);
        setForm(toForm(result.policy));
        setMessage({
          kind: 'ok',
          text: result.policy.enabled
            ? 'Autopilot is ON. The next scheduled tick will fill your queue.'
            : 'Autopilot settings saved (currently off).',
        });
        router.refresh();
      }
    });
  };

  const handleRunNow = () => {
    setMessage(null);
    startRun(async () => {
      const result = await runAutopilotNow(workspaceId);
      if ('error' in result && result.error) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if ('result' in result && result.result) {
        const r = result.result;
        setMessage({
          kind: r.status === 'FAILED' ? 'error' : 'ok',
          text: `Run ${r.status.toLowerCase()}: ${r.itemsScheduled} scheduled, ${r.itemsSkipped} skipped${
            r.reason ? ` — ${r.reason}` : ''
          }.`,
        });
        router.refresh();
      }
    });
  };

  const toggleChannel = (channel: (typeof PUBLISHABLE_CHANNELS)[number]) =>
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(channel)
        ? f.channels.filter((c) => c !== channel)
        : [...f.channels, channel],
    }));

  const toggleDay = (day: number) =>
    setForm((f) => ({
      ...f,
      publishDays: f.publishDays.includes(day)
        ? f.publishDays.filter((d) => d !== day)
        : [...f.publishDays, day].sort(),
    }));

  return (
    <div className="space-y-6">
      {/* ── Status header ── */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${policy?.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
              <Bot className={`w-6 h-6 ${policy?.enabled ? 'text-green-700' : 'text-gray-500'}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Autopilot</h2>
              <p className="text-gray-600 text-sm mt-1 max-w-2xl">
                When on, Contivo ideates, drafts and schedules posts for you on a cadence — no
                clicks. Publishing happens automatically when each slot arrives.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>
                  Status:{' '}
                  <span className={`font-semibold ${policy?.enabled ? 'text-green-700' : 'text-gray-700'}`}>
                    {policy?.enabled ? 'ON' : 'OFF'}
                  </span>
                </span>
                {policy?.lastRunAt && <span>Last run: {formatDate(policy.lastRunAt)}</span>}
                {policy?.enabled && policy?.nextRunAt && (
                  <span>Next run: {formatDate(policy.nextRunAt)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunNow}
              disabled={!policy?.enabled || isRunning || isSaving}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 border ${
                policy?.enabled && !isRunning
                  ? 'bg-white text-gray-900 hover:bg-gray-50'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
              title={policy?.enabled ? 'Run one cycle now' : 'Enable and save first'}
            >
              <Play className="w-4 h-4" />
              {isRunning ? 'Running…' : 'Run now'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isRunning}
              className="px-4 py-2 rounded-lg font-semibold flex items-center gap-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Readiness warnings */}
        <div className="mt-4 space-y-2">
          {!ideationReady && (
            <Warning>
              This workspace can&apos;t ideate yet. Autopilot needs Brand Memory, Market Matrices and
              Competitor Keywords — run those tabs first. Runs will be skipped until then.
            </Warning>
          )}
          {!anyChannelConnected && (
            <Warning>
              None of the selected channels has a connected default account. Connect one on the{' '}
              <a href="/connections" className="underline font-semibold">
                Connections
              </a>{' '}
              page or Autopilot will skip every run.
            </Warning>
          )}
          {message && (
            <div
              className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
                message.kind === 'ok'
                  ? 'bg-green-50 border-green-200 text-green-900'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {message.kind === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Policy form ── */}
      <div className="bg-white rounded-lg border p-6 space-y-6">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-5 w-5 accent-red-600"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <span className="font-semibold">Enable Autopilot for this workspace</span>
          <Zap className="w-4 h-4 text-amber-500" />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Posts per week">
            <input
              type="number"
              min={1}
              max={14}
              value={form.postsPerWeek}
              onChange={(e) => setForm((f) => ({ ...f, postsPerWeek: Number(e.target.value) }))}
              className={inputCls}
            />
            <Hint>Autopilot keeps the coming 7 days topped up to this number.</Hint>
          </Field>

          <Field label="Timezone">
            <input
              type="text"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className={inputCls}
              placeholder="America/Toronto"
            />
            <Hint>IANA name. Publish window and days are interpreted in this zone.</Hint>
          </Field>

          <Field label="Channels">
            <div className="flex flex-wrap gap-2">
              {PUBLISHABLE_CHANNELS.map((channel) => {
                const on = form.channels.includes(channel);
                const connected = channelIsConnected(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => toggleChannel(channel)}
                    className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-2 ${
                      on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700'
                    }`}
                  >
                    {CHANNEL_LABELS[channel] ?? channel}
                    <span
                      className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={connected ? 'Connected' : 'No connected default account'}
                    />
                  </button>
                );
              })}
            </div>
            <Hint>Green dot = a default account is connected for that channel.</Hint>
          </Field>

          <Field label="Publish days">
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => {
                const on = form.publishDays.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-11 py-1.5 rounded-md text-sm border ${
                      on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Publish window (local hours)">
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={23}
                value={form.windowStartHour}
                onChange={(e) => setForm((f) => ({ ...f, windowStartHour: Number(e.target.value) }))}
                className={`${inputCls} w-24`}
              />
              <span className="text-gray-500">to</span>
              <input
                type="number"
                min={1}
                max={24}
                value={form.windowEndHour}
                onChange={(e) => setForm((f) => ({ ...f, windowEndHour: Number(e.target.value) }))}
                className={`${inputCls} w-24`}
              />
            </div>
            <Hint>e.g. 9 to 18 = posts land between 09:00 and 17:59.</Hint>
          </Field>

          <Field label="Primary goal">
            <select
              value={form.goal ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              className={inputCls}
            >
              <option value="authority">Authority</option>
              <option value="awareness">Awareness</option>
              <option value="engagement">Engagement</option>
              <option value="leads">Leads</option>
              <option value="education">Education</option>
            </select>
          </Field>

          <Field label="Lean into these themes">
            <textarea
              rows={3}
              value={hintsText}
              onChange={(e) => setHintsText(e.target.value)}
              className={inputCls}
              placeholder="e.g. AI adoption for SMEs, founder lessons, product updates"
            />
            <Hint>Comma or newline separated. Passed to the AI as steering.</Hint>
          </Field>

          <Field label="Never write about">
            <textarea
              rows={3}
              value={avoidText}
              onChange={(e) => setAvoidText(e.target.value)}
              className={inputCls}
              placeholder="e.g. pricing, politics, competitor names"
            />
            <Hint>Ideas whose topic contains any of these phrases are dropped.</Hint>
          </Field>
        </div>
      </div>

      {/* ── Run history ── */}
      <div className="bg-white rounded-lg border">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Run history</h3>
          <span className="text-xs text-gray-500">{runs.length} most recent</span>
        </div>
        {runs.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No runs yet. Enable Autopilot and save, or click Run now.</p>
        ) : (
          <ul className="divide-y">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

const inputCls =
  'block w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-black focus:outline-none focus:ring-1 focus:ring-black';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-gray-500">{children}</p>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <span>{children}</span>
    </div>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case 'SUCCEEDED':
      return 'bg-green-100 text-green-800';
    case 'PARTIAL':
      return 'bg-amber-100 text-amber-800';
    case 'FAILED':
      return 'bg-red-100 text-red-800';
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function RunRow({ run }: { run: SerializedRun }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusStyle(run.status)}`}>
            {run.status}
          </span>
          <span className="text-sm text-gray-900">{formatDate(run.startedAt)}</span>
          <span className="text-xs text-gray-500">via {run.trigger}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600 shrink-0">
          <span>{run.ideasGenerated} ideas</span>
          <span className="font-semibold text-gray-900">{run.itemsScheduled} scheduled</span>
          <span>{run.itemsSkipped} skipped</span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      {run.error && <p className="mt-2 text-xs text-red-700">{run.error}</p>}
      {open && (
        <ol className="mt-3 space-y-1 text-xs font-mono text-gray-700 bg-gray-50 rounded-md p-3 overflow-x-auto">
          {run.log.map((entry, i) => {
            const { at, step, ...rest } = entry as { at?: string; step?: string } & Record<string, unknown>;
            return (
              <li key={i} className="whitespace-nowrap">
                <span className="text-gray-400">{at ? new Date(at).toLocaleTimeString() : ''}</span>{' '}
                <span className="font-semibold">{step}</span>{' '}
                <span className="text-gray-600">{Object.keys(rest).length ? JSON.stringify(rest) : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

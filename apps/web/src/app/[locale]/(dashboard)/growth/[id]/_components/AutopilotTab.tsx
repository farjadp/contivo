'use client';

import { useState, useTransition } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronUp, Play, Plus, Save, Zap } from 'lucide-react';

import {
  createAgent,
  runAutopilotNow,
  saveAutopilotPolicy,
  type AutopilotPolicyInput,
  type SerializedPolicy,
  type SerializedRun,
} from '@/app/actions/autopilot';
import { AGENT_RECIPES } from '@/lib/autopilot/recipes';
import { CHANNEL_LABELS, CHANNEL_TO_PLATFORM, PUBLISHABLE_CHANNELS } from '@/lib/autopilot/channels';

type Props = {
  workspaceId: string;
  initialPolicy: SerializedPolicy | null;
  initialAgents?: SerializedPolicy[];
  initialRuns: SerializedRun[];
  connectedPlatforms: Array<{ platform: string; accountName: string }>;
  hasSiteConnection: boolean;
  ideationReady: boolean;
  /** The workspace's storylines, so an agent can be bound to a subset. */
  storylines?: Array<{ id: string; claim: string }>;
};

/**
 * JS day indices, in the order the week is read. Persian weeks open on
 * Saturday (شنبه) and close on Friday; English keeps Sunday first. The stored
 * values are untouched — only the order the buttons are laid out changes.
 */
const WEEK_ORDER: Record<string, number[]> = {
  fa: [6, 0, 1, 2, 3, 4, 5],
  default: [0, 1, 2, 3, 4, 5, 6],
};

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
  storylineIds: [],
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
    storylineIds: p.storylineIds ?? [],
  };
}

export function AutopilotTab({
  workspaceId,
  initialPolicy,
  initialAgents,
  initialRuns,
  connectedPlatforms,
  hasSiteConnection,
  ideationReady,
  storylines = [],
}: Props) {
  const t = useTranslations('tabsA');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const agents = initialAgents ?? (initialPolicy ? [initialPolicy] : []);
  // Which agent the editor below is bound to.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPolicy?.id ?? agents[0]?.id ?? null,
  );
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0] ?? null;
  const [showRecipes, setShowRecipes] = useState(agents.length === 0);
  const [isCreating, startCreate] = useTransition();

  const handleCreate = (recipeKey: string) => {
    setMessage(null);
    startCreate(async () => {
      const result = await createAgent(workspaceId, recipeKey);
      if ('error' in result && result.error) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if ('agent' in result && result.agent) {
        setSelectedId(result.agent.id);
        setShowRecipes(false);
        setMessage({
          kind: 'ok',
          text: t('autopilot.agents.created', { name: result.agent.name }),
        });
        router.refresh();
      }
    });
  };
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
    // blog publishes through the Content API, so a site connection is what counts.
    if (channel === 'blog') return hasSiteConnection;
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
        agentId: selected?.id,
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
            ? t('autopilot.messages.savedOn')
            : t('autopilot.messages.savedOff'),
        });
        router.refresh();
      }
    });
  };

  const handleRunNow = () => {
    setMessage(null);
    startRun(async () => {
      const result = await runAutopilotNow(workspaceId, selected?.id);
      if ('error' in result && result.error) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if ('result' in result && result.result) {
        const r = result.result;
        const status = runStatusLabel(t, 'autopilot.runStatusLower', r.status);
        setMessage({
          kind: r.status === 'FAILED' ? 'error' : 'ok',
          text: r.reason
            ? t('autopilot.messages.runResultWithReason', {
                status,
                scheduled: r.itemsScheduled,
                skipped: r.itemsSkipped,
                reason: r.reason,
              })
            : t('autopilot.messages.runResult', {
                status,
                scheduled: r.itemsScheduled,
                skipped: r.itemsSkipped,
              }),
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
      {/* ── Agents ── */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('autopilot.agents.title')}</h2>
            <p className="text-gray-600 text-sm mt-1 max-w-2xl">{t('autopilot.agents.body')}</p>
          </div>
          <button
            onClick={() => setShowRecipes((v) => !v)}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
            {t('autopilot.agents.new')}
          </button>
        </div>

        {agents.length > 0 && (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {agents.map((a) => {
              const isSelected = a.id === selected?.id;
              return (
                <li key={a.id}>
                  <button
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full text-start rounded-lg border p-3.5 transition-colors ${
                      isSelected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[15px]">{a.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                          a.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {a.enabled ? t('autopilot.agents.on') : t('autopilot.agents.off')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {[
                        t('autopilot.agents.postsPerWeek', { count: a.postsPerWeek }),
                        a.channels.map((c) => channelLabel(t, c)).join('، ') ||
                          t('autopilot.agents.noChannel'),
                        ...(a.lastRunAt
                          ? [
                              t('autopilot.agents.lastRun', {
                                date: format.dateTime(new Date(a.lastRunAt), {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                }),
                              }),
                            ]
                          : []),
                      ].join(' · ')}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {showRecipes && (
          <div className="mt-5 border-t pt-5">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
              {t('autopilot.agents.recipesTitle')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {AGENT_RECIPES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleCreate(r.key)}
                  disabled={isCreating}
                  className="text-start rounded-lg border border-gray-200 p-3.5 hover:border-gray-400 disabled:opacity-60"
                >
                  <p className="font-semibold text-[15px]">{t(`autopilot.recipes.${r.key}.name`)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t(`autopilot.recipes.${r.key}.tagline`)}</p>
                  <p className="mt-2 text-[11px] text-gray-400">
                    {[
                      t('autopilot.agents.postsPerWeek', { count: r.defaults.postsPerWeek }),
                      r.defaults.channels.map((c) => channelLabel(t, c)).join('، '),
                      r.requires === 'site'
                        ? t('autopilot.recipes.requiresSite')
                        : r.requires === 'social'
                          ? t('autopilot.recipes.requiresSocial')
                          : t('autopilot.recipes.requiresEither'),
                    ].join(' · ')}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Status header ── */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${policy?.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
              <Bot className={`w-6 h-6 ${policy?.enabled ? 'text-green-700' : 'text-gray-500'}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{selected?.name ?? t('autopilot.status.defaultName')}</h2>
              <p className="text-gray-600 text-sm mt-1 max-w-2xl">{t('autopilot.status.body')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>
                  {t('autopilot.status.label')}{' '}
                  <span className={`font-semibold ${policy?.enabled ? 'text-green-700' : 'text-gray-700'}`}>
                    {policy?.enabled ? t('autopilot.status.on') : t('autopilot.status.off')}
                  </span>
                </span>
                {policy?.lastRunAt && (
                  <span>
                    {t('autopilot.status.lastRun', {
                      date: format.dateTime(new Date(policy.lastRunAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                )}
                {policy?.enabled && policy?.nextRunAt && (
                  <span>
                    {t('autopilot.status.nextRun', {
                      date: format.dateTime(new Date(policy.nextRunAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
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
              title={
                policy?.enabled
                  ? t('autopilot.actions.runNowTitle')
                  : t('autopilot.actions.runDisabledTitle')
              }
            >
              <Play className="w-4 h-4 rtl:rotate-180" />
              {isRunning ? t('autopilot.actions.running') : t('autopilot.actions.runNow')}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isRunning}
              className="px-4 py-2 rounded-lg font-semibold flex items-center gap-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {isSaving ? t('autopilot.actions.saving') : t('autopilot.actions.save')}
            </button>
          </div>
        </div>

        {/* Readiness warnings */}
        <div className="mt-4 space-y-2">
          {!ideationReady && (
            <Warning>{t('autopilot.warnings.ideation')}</Warning>
          )}
          {!anyChannelConnected && (
            <Warning>
              {t.rich('autopilot.warnings.channels', {
                link: (chunks) => (
                  <Link href="/connections" className="underline font-semibold">
                    {chunks}
                  </Link>
                ),
              })}
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
          <span className="font-semibold">{t('autopilot.form.enable')}</span>
          <Zap className="w-4 h-4 text-amber-500" />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label={t('autopilot.form.postsPerWeek')}>
            <input
              type="number"
              min={1}
              max={14}
              value={form.postsPerWeek}
              onChange={(e) => setForm((f) => ({ ...f, postsPerWeek: Number(e.target.value) }))}
              className={inputCls}
            />
            <Hint>{t('autopilot.form.postsPerWeekHint')}</Hint>
          </Field>

          <Field label={t('autopilot.form.timezone')}>
            <input
              type="text"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className={inputCls}
              dir="ltr"
              placeholder="America/Toronto"
            />
            <Hint>{t('autopilot.form.timezoneHint')}</Hint>
          </Field>

          <Field label={t('autopilot.form.channels')}>
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
                    {channelLabel(t, channel)}
                    <span
                      className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={
                        connected
                          ? t('autopilot.channelDot.ready')
                          : channel === 'blog'
                            ? t('autopilot.channelDot.noSite')
                            : t('autopilot.channelDot.noAccount')
                      }
                    />
                  </button>
                );
              })}
            </div>
            <Hint>{t('autopilot.form.channelsHint')}</Hint>
          </Field>

          <Field label={t('autopilot.form.publishDays')}>
            <div className="flex flex-wrap gap-2">
              {(WEEK_ORDER[locale] ?? WEEK_ORDER.default).map((day) => {
                const on = form.publishDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-11 py-1.5 rounded-md text-sm border ${
                      on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700'
                    }`}
                  >
                    {t(`autopilot.days.${day}`)}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label={t('autopilot.form.window')}>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={23}
                value={form.windowStartHour}
                onChange={(e) => setForm((f) => ({ ...f, windowStartHour: Number(e.target.value) }))}
                className={`${inputCls} w-24`}
              />
              <span className="text-gray-500">{t('autopilot.form.windowTo')}</span>
              <input
                type="number"
                min={1}
                max={24}
                value={form.windowEndHour}
                onChange={(e) => setForm((f) => ({ ...f, windowEndHour: Number(e.target.value) }))}
                className={`${inputCls} w-24`}
              />
            </div>
            <Hint>{t('autopilot.form.windowHint')}</Hint>
          </Field>

          <Field label={t('autopilot.form.goal')}>
            <select
              value={form.goal ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              className={inputCls}
            >
              <option value="authority">{t('goals.authority')}</option>
              <option value="awareness">{t('goals.awareness')}</option>
              <option value="engagement">{t('goals.engagement')}</option>
              <option value="leads">{t('goals.leads')}</option>
              <option value="education">{t('goals.education')}</option>
            </select>
          </Field>

          {/* A workspace that predates the narrative layer keeps publishing, so
              this is an invitation rather than a block. Saying nothing would
              leave the agent quietly writing without a position. */}
          {storylines.length === 0 && (
            <div className="border border-ink-200 bg-ink-50 px-4 py-3.5">
              <p className="text-[13px] font-medium text-ink-900">{t('autopilot.narrative.title')}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{t('autopilot.narrative.body')}</p>
              <Link
                href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: 'narrative' } }}
                className="mt-2.5 inline-block text-[12.5px] font-medium text-ink-900 underline underline-offset-4 hover:text-ink-600"
              >
                {t('autopilot.narrative.cta')}
              </Link>
            </div>
          )}

          {storylines.length > 0 && (
            <Field label={t('autopilot.form.storylines')}>
              <div className="space-y-2">
                {storylines.map((sl) => {
                  const bound = form.storylineIds ?? [];
                  const checked = bound.length === 0 || bound.includes(sl.id);
                  return (
                    <label key={sl.id} className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          // An empty list means "all", so the first deselection has
                          // to expand it to the explicit set minus this one.
                          const current = bound.length === 0 ? storylines.map((x) => x.id) : bound;
                          const next = e.target.checked
                            ? [...new Set([...current, sl.id])]
                            : current.filter((id) => id !== sl.id);
                          setForm({
                            ...form,
                            storylineIds: next.length === storylines.length ? [] : next,
                          });
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                      />
                      <span className="text-[13px] leading-snug text-ink-700">{sl.claim}</span>
                    </label>
                  );
                })}
              </div>
              <Hint>{t('autopilot.form.storylinesHint')}</Hint>
            </Field>
          )}

          <Field label={t('autopilot.form.themes')}>
            <textarea
              rows={3}
              value={hintsText}
              onChange={(e) => setHintsText(e.target.value)}
              className={inputCls}
              placeholder={t('autopilot.form.themesPlaceholder')}
            />
            <Hint>{t('autopilot.form.themesHint')}</Hint>
          </Field>

          <Field label={t('autopilot.form.avoid')}>
            <textarea
              rows={3}
              value={avoidText}
              onChange={(e) => setAvoidText(e.target.value)}
              className={inputCls}
              placeholder={t('autopilot.form.avoidPlaceholder')}
            />
            <Hint>{t('autopilot.form.avoidHint')}</Hint>
          </Field>
        </div>
      </div>

      {/* ── Run history ── */}
      <div className="bg-white rounded-lg border">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('autopilot.runs.title')}</h3>
          <span className="text-xs text-gray-500">{t('autopilot.runs.count', { count: runs.length })}</span>
        </div>
        {runs.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">{t('autopilot.runs.empty')}</p>
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

/** `CHANNEL_LABELS` is data; the human half of it is copy, so it is looked up here. */
function channelLabel(t: ReturnType<typeof useTranslations>, channel: string) {
  return t.has(`channels.${channel}`)
    ? t(`channels.${channel}`)
    : (CHANNEL_LABELS[channel] ?? channel);
}

/** Run statuses arrive as raw enum values; unknown ones fall back to the enum. */
function runStatusLabel(
  t: ReturnType<typeof useTranslations>,
  prefix: string,
  status: string,
) {
  return t.has(`${prefix}.${status}`) ? t(`${prefix}.${status}`) : status;
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
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
  const t = useTranslations('tabsA');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  return (
    <li className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 text-start"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusStyle(run.status)}`}>
            {runStatusLabel(t, 'autopilot.runStatus', run.status)}
          </span>
          <span className="text-sm text-gray-900">
            {format.dateTime(new Date(run.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <span className="text-xs text-gray-500">{t('autopilot.runs.via', { trigger: run.trigger })}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600 shrink-0">
          <span>{t('autopilot.runs.ideas', { count: run.ideasGenerated })}</span>
          <span className="font-semibold text-gray-900">
            {t('autopilot.runs.scheduled', { count: run.itemsScheduled })}
          </span>
          <span>{t('autopilot.runs.skipped', { count: run.itemsSkipped })}</span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      {run.error && <p className="mt-2 text-xs text-red-700">{run.error}</p>}
      {open && (
        <ol
          dir="ltr"
          className="mt-3 space-y-1 text-xs font-mono text-gray-700 bg-gray-50 rounded-md p-3 overflow-x-auto text-left"
        >
          {run.log.map((entry, i) => {
            const { at, step, ...rest } = entry as { at?: string; step?: string } & Record<string, unknown>;
            return (
              <li key={i} className="whitespace-nowrap">
                <span className="text-gray-400">
                  {at ? format.dateTime(new Date(at), { timeStyle: 'medium' }) : ''}
                </span>{' '}
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


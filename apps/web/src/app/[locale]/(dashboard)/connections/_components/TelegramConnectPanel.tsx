/**
 * TelegramConnectPanel.tsx
 *
 * "Connect Telegram" inside the Connect modal. Telegram has no OAuth: the user
 * opens the Contivo bot through a one-time deep link, taps Start, picks the
 * channel in Telegram (which adds the bot as an admin that can only post),
 * and types back the code the bot sent. Reconnecting a TELEGRAM row runs the
 * same flow; the API upserts the same connection.
 *
 * The session lives in the API. This panel starts it, polls it every few
 * seconds while open, and stops on unmount, expiry or a terminal status.
 * Opening the panel creates one session, also under StrictMode's double
 * mount effect (createStartOnce).
 * All calls go through server actions (actions/social-telegram.ts).
 *
 * TelegramConnectSteps is the stateless view, rendered on its own in tests.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, ExternalLink, Loader2, Send } from 'lucide-react';

import {
  confirmTelegramConnect,
  getTelegramConnect,
  startTelegramConnect,
  submitTelegramUsername,
} from '@/app/actions/social-telegram';
import { useRouter } from '@/i18n/navigation';
import {
  TELEGRAM_CODE_LENGTH,
  TELEGRAM_POLL_MS,
  createStartOnce,
  isCompleteCode,
  isExpired,
  endsSession,
  failedReason,
  isTerminalStatus,
  normalizeCodeInput,
  panelStep,
  type TelegramErrorCode,
  type TelegramPanelStep,
  type TelegramSessionStart,
  type TelegramSessionView,
} from '@/lib/telegram-connect';

const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

// ─── View ─────────────────────────────────────────────────────────────────────

export interface TelegramConnectStepsProps {
  /** null while the session is being created, or when creating it failed. */
  start: TelegramSessionStart | null;
  step: TelegramPanelStep;
  view: TelegramSessionView | null;
  /** The last failed action, or the session's own problem. */
  error: TelegramErrorCode | null;
  attemptsLeft: number | null;
  busy: boolean;
  username: string;
  code: string;
  onUsernameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onUsernameMode: (on: boolean) => void;
  onSubmitUsername: () => void;
  onSubmitCode: () => void;
  onRestart: () => void;
  onDone: () => void;
}

const primaryButton =
  'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#229ED9] py-3 text-sm font-bold text-chalk shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60';
const secondaryButton =
  'w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rule-strong bg-chalk-raised py-2.5 text-sm font-semibold text-moss transition-colors hover:bg-chalk-sunk disabled:opacity-60';
const inputClass =
  'block w-full rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2.5 text-sm text-moss outline-none focus:border-moss focus:ring-1 focus:ring-moss';

function Waiting({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-moss-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

function StepHeading({ index, title }: { index: number | null; title: string }) {
  const t = useTranslations('connections.telegram');
  return (
    <div className="mb-2">
      {index != null && (
        <p className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">
          {t('stepOf', { step: index, total: 3 })}
        </p>
      )}
      <h3 className="text-base font-bold text-moss">{title}</h3>
    </div>
  );
}

export function TelegramConnectSteps(props: TelegramConnectStepsProps) {
  const t = useTranslations('connections.telegram');
  const { start, step, view, error, attemptsLeft, busy } = props;

  const errorLine = error ? (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
      {t(`errors.${error}`)}
      {error === 'wrong_code' && attemptsLeft != null && <> {t('attemptsLeft', { count: attemptsLeft })}</>}
    </p>
  ) : null;

  // Creating the session, or creating it failed.
  if (!start && step !== 'connected') {
    return (
      <div className="space-y-4">
        {errorLine ?? <Waiting label={t('starting')} />}
        {errorLine && (
          <button type="button" onClick={props.onRestart} disabled={busy} className={secondaryButton}>
            {t('retry')}
          </button>
        )}
      </div>
    );
  }

  switch (step) {
    case 'open':
      return (
        <div className="space-y-4">
          <StepHeading index={1} title={t('openTitle')} />
          <p className="text-sm text-moss-muted">{t('openBody')}</p>
          <a href={start!.deepLink} target="_blank" rel="noopener noreferrer" className={primaryButton}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {t('openButton')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          {errorLine}
          <Waiting label={t('waitingStart')} />
        </div>
      );

    case 'choose':
      return (
        <div className="space-y-4">
          <StepHeading index={2} title={t('chooseTitle')} />
          <p className="text-sm text-moss-muted">{t('chooseBody')}</p>
          {errorLine}
          <Waiting label={t('waitingChoice')} />
          <div className="flex flex-col gap-2 border-t border-rule pt-4">
            <a
              href={start!.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-moss-700 hover:underline"
            >
              {t('openAgain')}
            </a>
            <button
              type="button"
              onClick={() => props.onUsernameMode(true)}
              className="text-start text-xs font-semibold text-moss-700 hover:underline"
            >
              {t('usernameLink')}
            </button>
          </div>
        </div>
      );

    case 'username':
      return (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmitUsername();
          }}
        >
          <StepHeading index={2} title={t('usernameTitle')} />
          <p className="text-sm text-moss-muted">{t('usernameBody')}</p>
          <div>
            <label htmlFor="tg-username" className="mb-1.5 block text-xs font-semibold text-moss">
              {t('usernameLabel')}
            </label>
            <input
              id="tg-username"
              type="text"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={props.username}
              onChange={(e) => props.onUsernameChange(e.target.value)}
              placeholder="@yourchannel"
              aria-invalid={error === 'invalid_username' || error === 'chat_not_found'}
              className={inputClass}
            />
          </div>
          {errorLine}
          <button type="submit" disabled={busy || !props.username.trim()} className={primaryButton}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? t('working') : t('usernameSubmit')}
          </button>
          <button
            type="button"
            onClick={() => props.onUsernameMode(false)}
            className="w-full text-xs font-semibold text-moss-700 hover:underline"
          >
            {t('usernameBack')}
          </button>
        </form>
      );

    case 'code':
      return (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmitCode();
          }}
        >
          <StepHeading index={3} title={t('codeTitle')} />
          <p className="text-sm text-moss-muted">{t('codeBody')}</p>
          <div>
            <label htmlFor="tg-code" className="mb-1.5 block text-xs font-semibold text-moss">
              {t('codeLabel')}
            </label>
            {/* Digits may be typed in Persian; they are normalised before sending. */}
            <input
              id="tg-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={TELEGRAM_CODE_LENGTH * 2}
              value={props.code}
              onChange={(e) => props.onCodeChange(e.target.value)}
              aria-invalid={error === 'wrong_code'}
              className={`${inputClass} text-center font-plexmono text-lg tracking-[0.4em]`}
            />
          </div>
          {errorLine}
          <button type="submit" disabled={busy || !isCompleteCode(normalizeCodeInput(props.code))} className={primaryButton}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? t('working') : t('codeSubmit')}
          </button>
        </form>
      );

    case 'connected': {
      const connection = view?.connection;
      return (
        <div className="space-y-4 text-center">
          <CheckCircle className="mx-auto h-10 w-10 text-green-600" aria-hidden="true" />
          <StepHeading index={null} title={t('connectedTitle')} />
          {connection && (
            <p className="text-sm text-moss-muted">
              {t.rich('connectedBody', { name: connection.accountName, bdi })}
              <br />
              <span className="text-xs">{t(`chatType.${connection.chatType}`)}</span>
              {connection.username && (
                <>
                  {' · '}
                  <bdi className="text-xs" dir="ltr">
                    @{connection.username}
                  </bdi>
                </>
              )}
            </p>
          )}
          <button type="button" onClick={props.onDone} className={primaryButton}>
            {t('done')}
          </button>
        </div>
      );
    }

    case 'failed':
    case 'expired':
      return (
        <div className="space-y-4">
          <StepHeading index={null} title={step === 'failed' ? t('failedTitle') : t('expiredTitle')} />
          <p className="text-sm text-moss-muted">
            {step === 'failed' ? t(`errors.${failedReason(view, error)}`) : t('expiredBody')}
          </p>
          <button type="button" onClick={props.onRestart} disabled={busy} className={primaryButton}>
            {t('startAgain')}
          </button>
        </div>
      );
  }
}

// ─── Container ────────────────────────────────────────────────────────────────

interface TelegramConnectPanelProps {
  workspaceId: string;
  onClose: () => void;
}

export function TelegramConnectPanel({ workspaceId, onClose }: TelegramConnectPanelProps) {
  const router = useRouter();
  const [start, setStart] = useState<TelegramSessionStart | null>(null);
  const [view, setView] = useState<TelegramSessionView | null>(null);
  const [expired, setExpired] = useState(false);
  const [usernameMode, setUsernameMode] = useState(false);
  const [actionError, setActionError] = useState<TelegramErrorCode | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  // Results of a session the user has already abandoned (Start again) are dropped.
  const generation = useRef(0);
  // StrictMode's double mount effect shares one start instead of creating two sessions.
  const [startOnce] = useState(() => createStartOnce<Awaited<ReturnType<typeof startTelegramConnect>>>());

  const begin = useCallback(async (fresh: boolean) => {
    const gen = ++generation.current;
    setStart(null);
    setView(null);
    setExpired(false);
    setUsernameMode(false);
    setActionError(null);
    setAttemptsLeft(null);
    setUsername('');
    setCode('');
    setBusy(true);
    const result = await startOnce(workspaceId, () => startTelegramConnect(workspaceId), { fresh });
    if (gen !== generation.current) return;
    setBusy(false);
    if (!result.ok) {
      setActionError(result.code);
      return;
    }
    setStart(result.data);
  }, [workspaceId, startOnce]);

  useEffect(() => {
    void begin(false);
    // Unmount (or a new workspace) invalidates whatever is still in flight.
    const gen = generation;
    return () => {
      gen.current++;
    };
  }, [begin]);

  const status = view?.status;
  const done = (status != null && isTerminalStatus(status)) || expired;

  // Poll while the session is moving. A chained timeout, not an interval, so a
  // slow answer never stacks a second request behind it.
  useEffect(() => {
    if (!start || done) return;
    const gen = generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped || gen !== generation.current) return;
      if (isExpired(start.expiresAt)) {
        setExpired(true);
        return;
      }
      const result = await getTelegramConnect(start.sessionId);
      if (stopped || gen !== generation.current) return;
      if (result.ok) {
        setView(result.data);
      } else if (result.code === 'session_not_found') {
        setExpired(true);
        return;
      }
      // Any other failure (network, 5xx) is transient: keep polling.
      timer = setTimeout(() => void tick(), TELEGRAM_POLL_MS);
    };

    timer = setTimeout(() => void tick(), TELEGRAM_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [start, done]);

  // Leaving the code step for any reason clears what was typed there.
  const step = panelStep(view, { expired, usernameMode });
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    setActionError(null);
    setAttemptsLeft(null);
    if (step === 'code') setCode('');
    if (step === 'code' || step === 'connected') setUsernameMode(false);
  }, [step]);

  // A session-level problem (bot not admin, …) shows until the user acts again.
  const error = actionError ?? (step === 'choose' || step === 'open' ? view?.error ?? null : null);

  const runAction = async (call: () => ReturnType<typeof confirmTelegramConnect>) => {
    if (!start) return;
    const gen = generation.current;
    setBusy(true);
    setActionError(null);
    const result = await call();
    if (gen !== generation.current) return;
    setBusy(false);
    if (result.ok) {
      setView(result.data);
      return;
    }
    if (result.code === 'session_not_found') {
      setExpired(true);
      return;
    }
    if (endsSession(result.code)) {
      // The session is over: straight to "Start again". session_finished has no
      // reason of its own, so read the session for it (denied, too many codes, …).
      const ended = result.code;
      setView((v) => (v ? { ...v, status: 'failed', error: ended === 'session_finished' ? undefined : ended } : v));
      if (ended === 'session_finished') {
        const fresh = await getTelegramConnect(start.sessionId);
        if (gen === generation.current && fresh.ok && fresh.data.status === 'failed') setView(fresh.data);
      }
      return;
    }
    setActionError(result.code);
    setAttemptsLeft(result.attemptsLeft ?? null);
    // The API may have moved the session back a step (bot_not_admin after a
    // code): read it now rather than on the next tick.
    if (result.code !== 'wrong_code' && result.code !== 'invalid_username') {
      const fresh = await getTelegramConnect(start.sessionId);
      if (gen === generation.current && fresh.ok) setView(fresh.data);
    }
  };

  return (
    <TelegramConnectSteps
      start={start}
      step={step}
      view={view}
      error={error}
      attemptsLeft={attemptsLeft}
      busy={busy}
      username={username}
      code={code}
      onUsernameChange={(value) => {
        setUsername(value);
        if (actionError) setActionError(null);
      }}
      onCodeChange={(value) => {
        setCode(value);
        if (actionError) setActionError(null);
      }}
      onUsernameMode={(on) => {
        setUsernameMode(on);
        setActionError(null);
      }}
      onSubmitUsername={() => void runAction(() => submitTelegramUsername(start!.sessionId, username.trim()))}
      onSubmitCode={() => void runAction(() => confirmTelegramConnect(start!.sessionId, normalizeCodeInput(code)))}
      onRestart={() => void begin(true)}
      onDone={() => {
        // Name the workspace in the URL (B17): a bare refresh re-resolves the
        // page, which may land on another workspace than the one connected.
        router.replace({ pathname: '/connections', query: { tab: 'social', workspaceId } });
        router.refresh();
        onClose();
      }}
    />
  );
}

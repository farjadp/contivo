/**
 * ConnectedAccountsSection.tsx
 *
 * Shows the list of connected social media accounts for the workspace.
 * Allows connecting new accounts, setting defaults, reconnecting,
 * and disconnecting existing accounts.
 *
 * Data is passed via props from the parent server component.
 */

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  Linkedin,
  Twitter,
  Facebook,
  Instagram,
  RefreshCw,
  Star,
  Trash2,
  Plus,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  Loader2,
  Send,
} from 'lucide-react';
import {
  disconnectSocialConnection,
  reconnectSocialConnection,
  setDefaultConnection,
  type SocialActionErrorCode,
} from '@/app/actions/social';
import { ActionErrorAlert } from '@/components/publishing/ActionErrorAlert';
import { canStartConnectFlow, needsReconnect } from '@/lib/publish-outcome';
import { socialActionDetail, type SocialActionDetail } from '@/lib/social-action-error';
import { telegramChatUrl, type ConnectionMeta } from '@/lib/telegram-connect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  accountIdentifier: string;
  status: string;
  isDefault: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  /**
   * Status once tokenExpiresAt is taken into account (lib/connection-health):
   * a LinkedIn row the API still calls CONNECTED reads EXPIRED or
   * EXPIRING_SOON here. Falls back to `status`.
   */
  effectiveStatus?: string;
  daysLeft?: number | null;
  /** The safe slice of metaJson (Telegram chat type, public username, why it was revoked). */
  meta?: ConnectionMeta;
}

type ActionKind = 'disconnect' | 'setDefault' | 'reconnect';

interface ConnectedAccountsSectionProps {
  accounts: SocialAccount[];
  workspaceId: string;
  onConnectNew: () => void;
  /** Opens the Connect modal on Telegram: a TELEGRAM row reconnects there, not on a sign-in page. */
  onReconnectTelegram: () => void;
}

// ─── Platform helpers ─────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  LINKEDIN:  { label: 'LinkedIn',  color: '#0A66C2', bg: '#EFF7FF', Icon: Linkedin },
  X:         { label: 'X',         color: '#000000', bg: '#F0F0F0', Icon: Twitter },
  FACEBOOK:  { label: 'Facebook',  color: '#1877F2', bg: '#EEF4FF', Icon: Facebook },
  INSTAGRAM: { label: 'Instagram', color: '#E1306C', bg: '#FFF0F4', Icon: Instagram },
  TELEGRAM:  { label: 'Telegram',  color: '#229ED9', bg: '#E8F6FC', Icon: Send },
};

/** Telegram rows: why the bot can no longer post, from metaJson.revokedReason. */
const TELEGRAM_REVOKED_HINT = {
  BOT_REMOVED: 'statusHint.telegramBotRemoved',
  BOT_RIGHTS_LOST: 'statusHint.telegramBotRightsLost',
} as const;

/**
 * The second line under the account name. A Telegram chat id (-100…) means
 * nothing to anyone: show what kind of chat it is and its public @username.
 */
function AccountDetail({ account, label }: { account: SocialAccount; label: string }) {
  const t = useTranslations('connections.accounts');
  if (account.platform !== 'TELEGRAM') {
    return (
      <>
        <bdi>{label}</bdi> · <bdi>{account.accountIdentifier}</bdi>
      </>
    );
  }
  const chatType = account.meta?.chatType;
  const url = telegramChatUrl(account.meta?.username);
  return (
    <>
      <bdi>{label}</bdi>
      {chatType && <> · {t(`telegramChatType.${chatType}`)}</>}
      {url && (
        <>
          {' · '}
          <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-moss-700 hover:underline">
            @{account.meta!.username}
          </a>
        </>
      )}
    </>
  );
}

/** `key` indexes into `connections.accounts.status.*` — the label itself is copy. */
const STATUS_META: Record<string, { key: string; color: string; Icon: React.ElementType }> = {
  CONNECTED:      { key: 'connected',     color: 'text-green-600',  Icon: CheckCircle },
  EXPIRED:        { key: 'expired',       color: 'text-yellow-600', Icon: Clock },
  EXPIRING_SOON:  { key: 'expiringSoon',  color: 'text-amber-700',  Icon: Clock },
  FAILED:         { key: 'failed',        color: 'text-red-600',    Icon: XCircle },
  REVOKED:        { key: 'revoked',       color: 'text-moss-muted',   Icon: XCircle },
  PENDING_REAUTH: { key: 'pendingReauth', color: 'text-orange-500', Icon: AlertCircle },
};

/** Network names stay Latin; isolating them keeps Persian punctuation on its own side. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

function hintKey(account: SocialAccount, statusKey: string, reconnectable: boolean): string {
  if (!reconnectable) return 'statusHint.unsupported';
  const reason = account.platform === 'TELEGRAM' && account.status === 'REVOKED' ? account.meta?.revokedReason : null;
  return reason ? TELEGRAM_REVOKED_HINT[reason] : `statusHint.${statusKey}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectedAccountsSection({
  accounts,
  workspaceId,
  onConnectNew,
  onReconnectTelegram,
}: ConnectedAccountsSectionProps) {
  const t = useTranslations('connections.accounts');
  const format = useFormatter();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  // One error per account row, so a failure is shown next to the button that caused it.
  const [errors, setErrors] = useState<Record<string, { action: ActionKind; detail: SocialActionDetail | null }>>({});

  const fail = (id: string, action: ActionKind, detail: SocialActionDetail | null) =>
    setErrors((prev) => ({ ...prev, [id]: { action, detail } }));
  const thrown = (err: unknown): SocialActionDetail | null =>
    err instanceof Error && err.message ? { kind: 'raw', text: err.message } : null;

  /**
   * Runs one server action for one row: pending state while it runs, the
   * returned `{error}` shown inline, and a server refresh on success so the
   * list reflects what the database now says.
   */
  const run = async (
    action: ActionKind,
    id: string,
    call: () => Promise<{ error?: string; code?: SocialActionErrorCode } | undefined>,
  ) => {
    setLoading(`${action}-${id}`);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await call();
      const detail = result ? socialActionDetail(result) : null;
      if (detail) {
        fail(id, action, detail);
        return;
      }
      router.refresh();
    } catch (err) {
      fail(id, action, thrown(err));
    } finally {
      setLoading(null);
    }
  };

  const handleDisconnect = (id: string) => {
    if (!confirm(t('disconnectConfirm'))) return;
    void run('disconnect', id, () => disconnectSocialConnection(id, workspaceId));
  };

  const handleSetDefault = (id: string) => {
    void run('setDefault', id, () => setDefaultConnection(id, workspaceId));
  };

  /**
   * Reconnect asks the API to restart this connection's flow; for OAuth
   * platforms it returns the provider sign-in URL and the browser goes there.
   * The callback updates the same row back to CONNECTED.
   */
  const handleReconnect = async (account: SocialAccount) => {
    const id = account.id;
    setLoading(`reconnect-${id}`);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await reconnectSocialConnection(id, workspaceId);
      if (result.data?.reconnect?.flow === 'telegram') {
        // No sign-in page: a new connect session upserts this same row.
        setLoading(null);
        onReconnectTelegram();
        return;
      }
      const url = result.data?.url;
      if (!url) {
        // reconnect_unsupported and every other code land here, localised.
        fail(id, 'reconnect', socialActionDetail(result) ?? { kind: 'message', key: 'api_error' });
        setLoading(null);
        router.refresh();
        return;
      }
      // Leave the spinner on: the page is about to navigate away.
      window.location.href = url;
    } catch (err) {
      fail(id, 'reconnect', thrown(err));
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-bold text-moss">{t('title')}</h3>
          <p className="text-xs text-moss-muted mt-0.5">{t('subtitle')}</p>
        </div>
        <button
          onClick={onConnectNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-moss text-chalk px-4 py-2 text-sm font-semibold hover:bg-moss-700 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('connect')}
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-rule p-10 text-center">
          <div className="flex justify-center gap-3 mb-4">
            {(['LINKEDIN', 'TELEGRAM'] as const).map((p) => {
              const { Icon, color } = PLATFORM_META[p];
              return (
                <div key={p} className="w-10 h-10 rounded-full flex items-center justify-center bg-chalk-sunk">
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
              );
            })}
          </div>
          <p className="text-sm font-semibold text-moss">{t('emptyTitle')}</p>
          <p className="text-xs text-moss-muted mt-1 mb-4">{t.rich('emptyBody', { bdi })}</p>
          <button
            onClick={onConnectNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-moss text-chalk px-4 py-2 text-sm font-semibold hover:bg-moss-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('emptyCta')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const platform = PLATFORM_META[account.platform] ?? PLATFORM_META.LINKEDIN;
            const effective = account.effectiveStatus ?? account.status;
            const status = STATUS_META[effective] ?? STATUS_META.CONNECTED;
            const days = account.daysLeft ?? 0;
            const StatusIcon = status.Icon;
            const PlatformIcon = platform.Icon;
            const rowBusy = loading?.endsWith(account.id) ?? false;
            const busy = (action: ActionKind) => loading === `${action}-${account.id}`;
            // Expiring soon: reconnecting now (the row stays CONNECTED) avoids the first failed post.
            const showReconnect = needsReconnect(effective) || effective === 'EXPIRING_SOON';
            const reconnectable = canStartConnectFlow(account.platform);
            const error = errors[account.id];
            const errorId = `account-error-${account.id}`;

            return (
              <div
                key={account.id}
                aria-busy={rowBusy}
                className={`rounded-2xl border bg-chalk-raised p-4 shadow-sm hover:shadow-md transition-shadow ${
                  showReconnect ? 'border-amber-300' : 'border-rule'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {/* Platform icon */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: platform.bg }}
                    >
                      <PlatformIcon className="w-5 h-5" style={{ color: platform.color }} />
                    </div>

                    {/* Account info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <p dir="auto" className="text-sm font-bold text-moss">{account.accountName}</p>
                        {account.isDefault && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                            <Star className="w-2.5 h-2.5" />
                            {t('defaultBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-moss-muted">
                        <AccountDetail account={account} label={platform.label} />
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Status */}
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status.color}`}>
                      <StatusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                      {t(`status.${status.key}`, { days })}
                    </span>

                    {/* Last sync */}
                    {account.lastSyncAt && (
                      <span className="text-xs text-moss-muted hidden md:block">
                        {/* Formatted through next-intl so the Persian side gets the
                            Persian calendar, Persian digits and Tehran time. */}
                        {t('synced', {
                          date: format.dateTime(new Date(account.lastSyncAt), {
                            dateStyle: 'medium',
                          }),
                        })}
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      {!account.isDefault && account.status === 'CONNECTED' && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(account.id)}
                          disabled={rowBusy}
                          title={t('setDefault')}
                          aria-label={t('setDefault')}
                          aria-describedby={error ? errorId : undefined}
                          className="p-1.5 rounded-lg text-moss-muted hover:text-amber-500 hover:bg-amber-50 transition-colors disabled:opacity-50"
                        >
                          {busy('setDefault') ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Star className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      )}
                      {showReconnect && reconnectable && (
                        <button
                          type="button"
                          onClick={() => void handleReconnect(account)}
                          disabled={rowBusy}
                          title={t('reconnectTitle')}
                          aria-describedby={error ? errorId : undefined}
                          className="inline-flex items-center gap-1 rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-chalk hover:bg-moss-700 transition-colors disabled:opacity-50"
                        >
                          {busy('reconnect') ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          {busy('reconnect') ? t('reconnecting') : t('reconnect')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDisconnect(account.id)}
                        disabled={rowBusy}
                        title={t('disconnectTitle')}
                        aria-label={t('disconnectTitle')}
                        aria-describedby={error ? errorId : undefined}
                        className="p-1.5 rounded-lg text-moss-muted hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {busy('disconnect') ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* What the status means and what to do about it. */}
                {showReconnect && (
                  <p className="mt-3 text-xs text-amber-800">
                    {t.rich(hintKey(account, status.key, reconnectable), {
                      platform: platform.label,
                      days,
                      bdi,
                    })}
                  </p>
                )}

                {error && (
                  <ActionErrorAlert
                    id={errorId}
                    className="mt-3"
                    headline={t(`errors.${error.action}`)}
                    detail={error.detail}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

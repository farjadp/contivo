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
} from 'lucide-react';
import { disconnectSocialConnection, setDefaultConnection } from '@/app/actions/social';
import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { canStartConnectFlow, needsReconnect } from '@/lib/publish-outcome';

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
}

type ActionKind = 'disconnect' | 'setDefault' | 'reconnect';

interface ConnectedAccountsSectionProps {
  accounts: SocialAccount[];
  workspaceId: string;
  onConnectNew: () => void;
}

// ─── Platform helpers ─────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  LINKEDIN:  { label: 'LinkedIn',  color: '#0A66C2', bg: '#EFF7FF', Icon: Linkedin },
  X:         { label: 'X',         color: '#000000', bg: '#F0F0F0', Icon: Twitter },
  FACEBOOK:  { label: 'Facebook',  color: '#1877F2', bg: '#EEF4FF', Icon: Facebook },
  INSTAGRAM: { label: 'Instagram', color: '#E1306C', bg: '#FFF0F4', Icon: Instagram },
};

/** `key` indexes into `connections.accounts.status.*` — the label itself is copy. */
const STATUS_META: Record<string, { key: string; color: string; Icon: React.ElementType }> = {
  CONNECTED:      { key: 'connected',     color: 'text-green-600',  Icon: CheckCircle },
  EXPIRED:        { key: 'expired',       color: 'text-yellow-600', Icon: Clock },
  FAILED:         { key: 'failed',        color: 'text-red-600',    Icon: XCircle },
  REVOKED:        { key: 'revoked',       color: 'text-moss-muted',   Icon: XCircle },
  PENDING_REAUTH: { key: 'pendingReauth', color: 'text-orange-500', Icon: AlertCircle },
};

/** Network names stay Latin; isolating them keeps Persian punctuation on its own side. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectedAccountsSection({
  accounts,
  workspaceId,
  onConnectNew,
}: ConnectedAccountsSectionProps) {
  const t = useTranslations('connections.accounts');
  const format = useFormatter();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  // One error per account row, so a failure is shown next to the button that caused it.
  const [errors, setErrors] = useState<Record<string, { action: ActionKind; detail: string | null }>>({});

  /**
   * Runs one server action for one row: pending state while it runs, the
   * returned `{error}` shown inline, and a server refresh on success so the
   * list reflects what the database now says.
   */
  const run = async (
    action: ActionKind,
    id: string,
    call: () => Promise<{ error?: string } | undefined>,
  ) => {
    setLoading(`${action}-${id}`);
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    try {
      const result = await call();
      if (result?.error) {
        setErrors((prev) => ({ ...prev, [id]: { action, detail: result.error ?? null } }));
        return;
      }
      router.refresh();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: { action, detail: err instanceof Error ? err.message : null },
      }));
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
   * Reconnect sends the browser back through the provider's sign-in, the same
   * flow as a first connection. Marking the row PENDING_REAUTH alone (the old
   * behaviour) never gave the user a way to actually sign in again.
   */
  const handleReconnect = async (account: SocialAccount) => {
    const id = account.id;
    setLoading(`reconnect-${id}`);
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    try {
      const result = await getSocialConnectUrl(account.platform.toLowerCase(), workspaceId);
      if ('error' in result) {
        setErrors((prev) => ({ ...prev, [id]: { action: 'reconnect', detail: result.error } }));
        setLoading(null);
        return;
      }
      // Leave the spinner on: the page is about to navigate away.
      window.location.href = result.url;
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: { action: 'reconnect', detail: err instanceof Error ? err.message : null },
      }));
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
            {(['LINKEDIN', 'X', 'FACEBOOK'] as const).map((p) => {
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
            const status = STATUS_META[account.status] ?? STATUS_META.CONNECTED;
            const StatusIcon = status.Icon;
            const PlatformIcon = platform.Icon;
            const rowBusy = loading?.endsWith(account.id) ?? false;
            const busy = (action: ActionKind) => loading === `${action}-${account.id}`;
            const showReconnect = needsReconnect(account.status);
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
                        <bdi>{platform.label}</bdi> · <bdi>{account.accountIdentifier}</bdi>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Status */}
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status.color}`}>
                      <StatusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                      {t(`status.${status.key}`)}
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
                    {t.rich(reconnectable ? `statusHint.${status.key}` : 'statusHint.unsupported', {
                      platform: platform.label,
                      bdi,
                    })}
                  </p>
                )}

                {error && (
                  <div
                    id={errorId}
                    role="alert"
                    className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    <p className="font-semibold">{t(`errors.${error.action}`)}</p>
                    {error.detail && (
                      <p dir="auto" className="mt-0.5 break-words text-red-600">
                        {error.detail}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

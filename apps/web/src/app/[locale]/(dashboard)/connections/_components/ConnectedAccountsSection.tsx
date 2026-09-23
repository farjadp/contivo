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
} from 'lucide-react';
import { disconnectSocialConnection, setDefaultConnection, reconnectSocialConnection } from '@/app/actions/social';

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

const STATUS_META: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  CONNECTED:      { label: 'Connected',    color: 'text-green-600',  Icon: CheckCircle },
  EXPIRED:        { label: 'Expired',      color: 'text-yellow-600', Icon: Clock },
  FAILED:         { label: 'Failed',       color: 'text-red-600',    Icon: XCircle },
  REVOKED:        { label: 'Revoked',      color: 'text-gray-500',   Icon: XCircle },
  PENDING_REAUTH: { label: 'Needs re-auth',color: 'text-orange-500', Icon: AlertCircle },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectedAccountsSection({
  accounts,
  workspaceId,
  onConnectNew,
}: ConnectedAccountsSectionProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleDisconnect = async (id: string) => {
    if (!confirm('Disconnect this account? Published content will remain on the platform.')) return;
    setLoading(`disconnect-${id}`);
    await disconnectSocialConnection(id, workspaceId);
    setLoading(null);
  };

  const handleSetDefault = async (id: string) => {
    setLoading(`default-${id}`);
    await setDefaultConnection(id, workspaceId);
    setLoading(null);
  };

  const handleReconnect = async (id: string) => {
    setLoading(`reconnect-${id}`);
    await reconnectSocialConnection(id, workspaceId);
    setLoading(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-bold text-[#121212]">Connected Accounts</h3>
          <p className="text-xs text-gray-500 mt-0.5">Manage your linked social media accounts.</p>
        </div>
        <button
          onClick={onConnectNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#2B2DFF] text-white px-4 py-2 text-sm font-semibold hover:bg-[#2325d4] transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Connect Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
          <div className="flex justify-center gap-3 mb-4">
            {(['LINKEDIN', 'X', 'FACEBOOK'] as const).map((p) => {
              const { Icon, color } = PLATFORM_META[p];
              return (
                <div key={p} className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-100">
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
              );
            })}
          </div>
          <p className="text-sm font-semibold text-gray-700">No accounts connected yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Connect LinkedIn, X, or Facebook to start publishing directly from Contivo.</p>
          <button
            onClick={onConnectNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2B2DFF] text-white px-4 py-2 text-sm font-semibold hover:bg-[#2325d4] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Connect your first account
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const platform = PLATFORM_META[account.platform] ?? PLATFORM_META.LINKEDIN;
            const status = STATUS_META[account.status] ?? STATUS_META.CONNECTED;
            const StatusIcon = status.Icon;
            const PlatformIcon = platform.Icon;
            const isLoading = loading?.endsWith(account.id);

            return (
              <div
                key={account.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
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
                      <p className="text-sm font-bold text-[#121212]">{account.accountName}</p>
                      {account.isDefault && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                          <Star className="w-2.5 h-2.5" />
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{platform.label} · {account.accountIdentifier}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Status */}
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status.color}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {status.label}
                  </span>

                  {/* Last sync */}
                  {account.lastSyncAt && (
                    <span className="text-xs text-gray-400 hidden md:block">
                      Synced {new Date(account.lastSyncAt).toLocaleDateString()}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    {!account.isDefault && account.status === 'CONNECTED' && (
                      <button
                        onClick={() => handleSetDefault(account.id)}
                        disabled={isLoading}
                        title="Set as default"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 transition-colors disabled:opacity-50"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    {(account.status === 'EXPIRED' || account.status === 'PENDING_REAUTH' || account.status === 'FAILED') && (
                      <button
                        onClick={() => handleReconnect(account.id)}
                        disabled={isLoading}
                        title="Reconnect account"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#2B2DFF] hover:underline disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reconnect
                      </button>
                    )}
                    <button
                      onClick={() => handleDisconnect(account.id)}
                      disabled={isLoading}
                      title="Disconnect"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

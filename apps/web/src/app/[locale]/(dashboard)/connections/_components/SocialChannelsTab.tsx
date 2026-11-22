/**
 * SocialChannelsTab.tsx
 *
 * Tabbed container for the Social Channels section of the Connections page.
 * Hosts 4 sub-tabs: Connected Accounts, Publish Rules, Publish Queue, Publish History.
 *
 * This is a client component so tab state is managed in-browser.
 * Data for each section is passed as props from the server page.
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Settings, Clock, History } from 'lucide-react';
import { ConnectedAccountsSection } from './ConnectedAccountsSection';
import { PublishRulesSection } from './PublishRulesSection';
import { PublishQueueSection } from './PublishQueueSection';
import { PublishHistorySection } from './PublishHistorySection';
import { ConnectModal, type Platform } from './ConnectModal';
import type { ConnectionMeta } from '@/lib/telegram-connect';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'accounts' | 'rules' | 'queue' | 'history';

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  accountIdentifier: string;
  status: string;
  isDefault: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  /** Status once tokenExpiresAt is taken into account (lib/connection-health). */
  effectiveStatus?: string;
  daysLeft?: number | null;
  meta: ConnectionMeta;
}

interface PublishJob {
  id: string;
  platform: string;
  status: string;
  scheduledAtUtc: string | null;
  externalPostUrl: string | null;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  publishedAtUtc: string | null;
  socialConnectionId: string | null;
  connectionStatus: string | null;
}

interface SocialChannelsTabProps {
  accounts: SocialAccount[];
  jobs: PublishJob[];
  workspaceId: string;
}

// ─── Tab config ───────────────────────────────────────────────────────────────

/*
  The narrow-screen label used to be `label.split(' ')[0]`, which is a rule
  about English word order: in English it produced three identical
  "Publish" tabs, and in Persian it would cut a phrase in half. Each tab now
  carries its own short label instead.
*/
const TABS: { id: TabId; key: string; Icon: React.ElementType }[] = [
  { id: 'accounts', key: 'accounts', Icon: Users },
  { id: 'rules',    key: 'rules',    Icon: Settings },
  { id: 'queue',    key: 'queue',    Icon: Clock },
  { id: 'history',  key: 'history',  Icon: History },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function SocialChannelsTab({
  accounts,
  jobs,
  workspaceId,
}: SocialChannelsTabProps) {
  const t = useTranslations('connections.socialTabs');
  const [activeTab, setActiveTab] = useState<TabId>('accounts');
  // null = closed; `platform` opens the modal straight on one (Telegram reconnect).
  const [connectModal, setConnectModal] = useState<{ platform?: Platform } | null>(null);
  const openConnect = () => setConnectModal({});
  const openTelegram = () => setConnectModal({ platform: 'TELEGRAM' });

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-1 bg-chalk-sunk rounded-2xl p-1 mb-6 overflow-x-auto">
        {TABS.map(({ id, key, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center',
              activeTab === id
                ? 'bg-chalk-raised text-moss-700 shadow-sm'
                : 'text-moss-muted hover:text-moss',
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t(key)}</span>
            <span className="sm:hidden">{t(`${key}Short`)}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'accounts' && (
          <ConnectedAccountsSection
            accounts={accounts}
            workspaceId={workspaceId}
            onConnectNew={openConnect}
            onReconnectTelegram={openTelegram}
          />
        )}
        {activeTab === 'rules' && <PublishRulesSection />}
        {activeTab === 'queue' && (
          <PublishQueueSection
            jobs={jobs}
            workspaceId={workspaceId}
            onOpenAccounts={() => setActiveTab('accounts')}
            onConnectNew={openConnect}
            onReconnectTelegram={openTelegram}
          />
        )}
        {activeTab === 'history' && (
          <PublishHistorySection
            jobs={jobs}
            workspaceId={workspaceId}
            onOpenAccounts={() => setActiveTab('accounts')}
            onConnectNew={openConnect}
            onReconnectTelegram={openTelegram}
          />
        )}
      </div>

      {/* Connect modal */}
      {connectModal && (
        <ConnectModal
          onClose={() => setConnectModal(null)}
          workspaceId={workspaceId}
          initialPlatform={connectModal.platform}
        />
      )}
    </div>
  );
}

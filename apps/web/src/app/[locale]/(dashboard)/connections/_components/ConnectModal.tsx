/**
 * ConnectModal.tsx
 *
 * OAuth connection modal for social platforms.
 * The "Continue to OAuth" button redirects to the NestJS backend endpoint:
 *   GET /api/v1/social/oauth/:platform/connect?workspaceId=...
 * which then redirects the browser to the platform's authorization page.
 * After the user authorizes, the platform calls our callback endpoint which
 * saves the encrypted token and redirects back to /connections.
 *
 * Telegram has no OAuth: choosing it shows TelegramConnectPanel (deep link to
 * the bot, pick the channel in Telegram, type back the code). `initialPlatform`
 * opens straight on a platform, for Reconnect on a TELEGRAM row.
 *
 * Only live channels are connectable. Every other planned network is listed
 * as "coming soon" with a "notify me" button that records demand (23 Nov,
 * strategy/2026-11-23-first-post-path.md section A). Telegram is connectable
 * only where the API has its bot token; elsewhere it is coming soon too.
 */

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { X, Linkedin, Twitter, AtSign, Info, ChevronRight, Send, Facebook, Instagram, Newspaper, Bell, Check } from 'lucide-react';

import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { getConfiguredPlatforms, type PlatformConfig } from '@/app/actions/social-config';
import { listChannelNotices, requestChannelNotice } from '@/app/actions/channel-interest';
import { COMING_SOON_NETWORKS, type ComingSoonNetwork } from '@/lib/channel-interest';
import { markConnectAttempt } from '@/lib/connect-attempt';

import { TelegramConnectPanel } from './TelegramConnectPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectModalProps {
  onClose: () => void;
  /** The workspace ID to embed in the OAuth state param so the callback knows which workspace to connect. */
  workspaceId: string;
  /** Open on this platform instead of the picker (Reconnect on a TELEGRAM row). */
  initialPlatform?: Platform;
}

/** Channels a customer can connect and publish to today. */
export type Platform = 'LINKEDIN' | 'TELEGRAM';

// ─── Platform config ──────────────────────────────────────────────────────────

/**
 * Only channels that publish end to end are offered (B12, 22 Nov): a LinkedIn
 * personal profile and a Telegram channel or group. Everything else is a
 * non-clickable "coming soon" row, the same list the site footer shows. Do not
 * add a platform here until it has published for real in production.
 *
 * Visual identity only. Labels and descriptions are message keys.
 */
const PLATFORMS: {
  id: Platform;
  key: string;
  color: string;
  bg: string;
  border: string;
  Icon: React.ElementType;
  scopes: string[];
}[] = [
  {
    id: 'LINKEDIN',
    key: 'linkedin',
    color: '#0A66C2',
    bg: '#EFF7FF',
    border: '#BFDBFE',
    Icon: Linkedin,
    // What the API actually asks for (social-oauth.service.ts linkedInAuthUrl).
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
  },
  {
    id: 'TELEGRAM',
    key: 'telegram',
    color: '#229ED9',
    bg: '#E8F6FC',
    border: '#B9E3F5',
    Icon: Send,
    // Not OAuth scopes: the admin right Telegram gives the bot in the chosen channel.
    scopes: ['can_post_messages'],
  },
];

/** Planned networks: shown so nobody hunts for them, never connectable from here. */
const SOON_ICONS: Record<ComingSoonNetwork, React.ElementType> = {
  telegram: Send,
  x: Twitter,
  wordpress: Newspaper,
  facebook: Facebook,
  instagram: Instagram,
  threads: AtSign,
};

/** Why each one is not here yet: Meta's networks wait on its app review. */
const SOON_HINT: Record<ComingSoonNetwork, 'telegram' | 'building' | 'meta'> = {
  telegram: 'telegram',
  x: 'building',
  wordpress: 'building',
  facebook: 'meta',
  instagram: 'meta',
  threads: 'meta',
};

/** Network names stay Latin; isolating them keeps Persian punctuation on its own side. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectModal({ onClose, workspaceId, initialPlatform }: ConnectModalProps) {
  const t = useTranslations('connections.modal');
  const [selected, setSelected] = useState<Platform | null>(initialPlatform ?? null);
  const [connectError, setConnectError] = useState('');
  const [isConnecting, startConnect] = useTransition();
  // Null means "we could not ask" — the API being down is not the same as a
  // platform being unconfigured, so the UI stays neutral rather than accusing.
  const [config, setConfig] = useState<PlatformConfig | null>(null);

  // Networks this workspace already asked to hear about, and the one being sent.
  const [notified, setNotified] = useState<Set<ComingSoonNetwork>>(new Set());
  const [notifying, setNotifying] = useState<ComingSoonNetwork | null>(null);
  const [notifyError, setNotifyError] = useState<ComingSoonNetwork | null>(null);

  useEffect(() => {
    void getConfiguredPlatforms().then(setConfig);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void listChannelNotices(workspaceId).then((networks) => setNotified(new Set(networks)));
  }, [workspaceId]);

  /** The API names platforms `linkedin`/`x`/`facebook`/`tiktok`/`telegram`. */
  const isUnavailable = (id: Platform) => config != null && config[id.toLowerCase()] === false;

  // Telegram without a bot token cannot be connected here: list it as coming
  // soon, where its demand is counted, instead of a dead live tile.
  const telegramSoon = isUnavailable('TELEGRAM') && initialPlatform !== 'TELEGRAM';
  const livePlatforms = PLATFORMS.filter((p) => !(p.id === 'TELEGRAM' && telegramSoon));
  const soonNetworks = COMING_SOON_NETWORKS.filter((n) => n !== 'telegram' || telegramSoon);

  const notify = async (network: ComingSoonNetwork) => {
    setNotifying(network);
    setNotifyError(null);
    try {
      const result = await requestChannelNotice(workspaceId, network);
      if ('error' in result) {
        setNotifyError(network);
        return;
      }
      setNotified((prev) => new Set(prev).add(network));
    } catch (error) {
      console.error(error);
      setNotifyError(network);
    } finally {
      setNotifying(null);
    }
  };

  // The API's /connect route is opened by the browser, so it cannot carry an
  // auth header. Mint a short-lived signed link first, then navigate to it.
  const handleConnect = () => {
    if (!selected) return;
    setConnectError('');
    startConnect(async () => {
      const result = await getSocialConnectUrl(selected.toLowerCase(), workspaceId);
      if ('error' in result) {
        setConnectError(result.error);
        return;
      }
      // LinkedIn's sign-in can drop the way back to us (B13); remember the
      // attempt so /connections can offer a retry if no result comes back.
      markConnectAttempt(selected.toLowerCase(), workspaceId);
      window.location.href = result.url;
    });
  };


  const platform = PLATFORMS.find((p) => p.id === selected);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-moss/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md bg-chalk-raised rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-rule">
          <div>
            <h2 className="text-lg font-bold text-moss">{t('title')}</h2>
            <p className="text-xs text-moss-muted mt-0.5">
              {selected ? t('subtitleReview') : t('subtitleChoose')}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-moss-muted hover:bg-chalk-sunk hover:text-moss transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {!selected ? (
            /* Platform picker */
            <div className="space-y-3">
              {livePlatforms.map((p) => {
                const PIcon = p.Icon;
                const unavailable = isUnavailable(p.id);
                const label = t(`platforms.${p.key}Label`);
                return (
                  <button
                    key={p.id}
                    onClick={() => !unavailable && setSelected(p.id)}
                    disabled={unavailable}
                    title={unavailable ? t('unavailableTitle', { platform: label }) : undefined}
                    className={`w-full flex items-center gap-4 rounded-2xl border p-4 transition-all text-start group ${
                      unavailable
                        ? 'border-dashed border-rule bg-chalk cursor-not-allowed'
                        : 'border-rule bg-chalk-raised hover:border-rule-strong hover:shadow-sm'
                    }`}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: p.bg }}
                    >
                      <PIcon className="w-5 h-5" style={{ color: p.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-moss">{label}</p>
                      <p className="text-xs text-moss-muted mt-0.5 line-clamp-1">
                        {unavailable
                          ? t(p.id === 'TELEGRAM' ? 'telegramUnavailable' : 'unavailableDescription')
                          : t.rich(`platforms.${p.key}Description`, { bdi })}
                      </p>
                    </div>
                    {!unavailable && (
                      <ChevronRight className="w-4 h-4 text-moss-muted group-hover:text-moss transition-colors rtl:rotate-180" />
                    )}
                  </button>
                );
              })}

              {/* Coming soon: every planned network, each with "notify me" */}
              <div className="pt-2">
                <p className="text-xs font-semibold text-moss-muted mb-2 uppercase tracking-wide">
                  {t('soonTitle')}
                </p>
                <ul className="space-y-2" aria-label={t('soonTitle')}>
                  {soonNetworks.map((network) => {
                    const Icon = SOON_ICONS[network];
                    const name = t(`soon.${network}`);
                    const done = notified.has(network);
                    const busy = notifying === network;
                    return (
                      <li
                        key={network}
                        className="flex items-center gap-3 rounded-2xl border border-dashed border-rule bg-chalk px-4 py-3"
                      >
                        <div className="w-9 h-9 rounded-xl bg-chalk-sunk flex items-center justify-center shrink-0 text-moss-muted">
                          <Icon className="w-4 h-4" aria-hidden />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-moss-muted">{name}</p>
                          {notifyError === network ? (
                            <p className="text-xs text-red-600 mt-0.5">{t('notifyFailed')}</p>
                          ) : (
                            <p className="text-xs text-moss-muted mt-0.5">{t(`soonHint.${SOON_HINT[network]}`)}</p>
                          )}
                        </div>
                        {done ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-moss-700">
                            <Check className="w-3.5 h-3.5" aria-hidden />
                            {t('notifyDone')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void notify(network)}
                            disabled={busy || !workspaceId}
                            aria-label={t('notifyAria', { platform: name })}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-rule-strong bg-chalk-raised px-3 py-1.5 text-xs font-semibold text-moss transition-colors hover:border-moss disabled:opacity-60"
                          >
                            <Bell className="w-3.5 h-3.5" aria-hidden />
                            {busy ? t('notifySending') : t('notifyMe')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            /* Platform detail + OAuth CTA */
            <div>
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-moss-700 font-semibold hover:underline mb-4 flex items-center gap-1.5"
              >
                <span aria-hidden className="rtl:rotate-180">
                  &larr;
                </span>
                {t('backToList')}
              </button>

              <div
                className="flex items-center gap-3 rounded-2xl p-4 mb-4"
                style={{ background: platform!.bg, border: `1px solid ${platform!.border}` }}
              >
                {(() => { const SelectedIcon = platform!.Icon; return (
                <div className="w-10 h-10 rounded-xl bg-chalk-raised flex items-center justify-center">
                  <SelectedIcon className="w-5 h-5" style={{ color: platform!.color }} />
                </div>); })()}
                <div>
                  <p className="text-sm font-bold text-moss">
                    {t(`platforms.${platform!.key}Label`)}
                  </p>
                  <p className="text-xs text-moss-muted">
                    {t.rich(`platforms.${platform!.key}Description`, { bdi })}
                  </p>
                </div>
              </div>

              {platform!.id === 'TELEGRAM' ? (
                <TelegramConnectPanel workspaceId={workspaceId} onClose={onClose} />
              ) : (
                <>
                  {/* Permissions */}
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-moss-muted mb-2 uppercase tracking-wide">
                      {t('permissionsTitle')}
                    </p>
                    <div className="space-y-1.5">
                      {platform!.scopes.map((scope) => (
                        <div key={scope} className="flex items-center gap-2 text-xs text-moss-muted">
                          <div className="w-1.5 h-1.5 rounded-full bg-moss" />
                          <code className="font-plexmono">{scope}</code>
                        </div>
                      ))}
                    </div>
                  </div>

                  {platform!.id === 'LINKEDIN' && (
                    <p className="text-xs text-moss-muted mb-3">{t('linkedinSignInHint')}</p>
                  )}

                  {/* Security note */}
                  <div className="flex gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 mb-5">
                    <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">{t('securityNote')}</p>
                  </div>

                  {/* CTA — mints a signed handoff link, then redirects to the provider */}
                  {connectError && (
                    <p className="mb-3 text-xs text-red-600">{connectError}</p>
                  )}
                  <button
                    onClick={handleConnect}
                    disabled={isConnecting}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-chalk shadow-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-60"
                    style={{ backgroundColor: platform!.color }}
                  >
                    {isConnecting ? (
                      t('preparing')
                    ) : (
                      <>
                        {/* The label is Latin either way, so it needs no isolation
                            of its own: the whole button is a Latin run. */}
                        {t('continueOAuth', {
                          platform: t(`platforms.${platform!.key}Label`),
                        })}
                        <span aria-hidden className="rtl:rotate-180">
                          &rarr;
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

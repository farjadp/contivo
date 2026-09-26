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
 * Phase 2: Add Instagram (requires Meta Business OAuth + media pipeline).
 */

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { X, Linkedin, Twitter, Facebook, Music2, Info, ChevronRight } from 'lucide-react';

import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { getConfiguredPlatforms, type PlatformConfig } from '@/app/actions/social-config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectModalProps {
  onClose: () => void;
  /** The workspace ID to embed in the OAuth state param so the callback knows which workspace to connect. */
  workspaceId: string;
}

type Platform = 'LINKEDIN' | 'X' | 'FACEBOOK' | 'TIKTOK';

// ─── Platform config ──────────────────────────────────────────────────────────

/**
 * Visual identity only. The label and the description are message keys, because
 * "Facebook Page" and "Post tweets and threads…" are copy, not configuration.
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
    scopes: ['w_member_social', 'r_basicprofile'],
  },
  {
    id: 'X',
    key: 'x',
    color: '#000000',
    bg: '#F0F0F0',
    border: '#E5E7EB',
    Icon: Twitter,
    scopes: ['tweet.write', 'tweet.read', 'users.read'],
  },
  {
    id: 'FACEBOOK',
    key: 'facebook',
    color: '#1877F2',
    bg: '#EEF4FF',
    border: '#BFDBFE',
    Icon: Facebook,
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
  },
  {
    id: 'TIKTOK',
    key: 'tiktok',
    color: '#010101',
    bg: '#F0F0F0',
    border: '#E5E7EB',
    Icon: Music2,
    scopes: ['video.publish', 'video.upload'],
  },
];

/** Network names stay Latin; isolating them keeps Persian punctuation on its own side. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectModal({ onClose, workspaceId }: ConnectModalProps) {
  const t = useTranslations('connections.modal');
  const [selected, setSelected] = useState<Platform | null>(null);
  const [connectError, setConnectError] = useState('');
  const [isConnecting, startConnect] = useTransition();
  // Null means "we could not ask" — the API being down is not the same as a
  // platform being unconfigured, so the UI stays neutral rather than accusing.
  const [config, setConfig] = useState<PlatformConfig | null>(null);

  useEffect(() => {
    void getConfiguredPlatforms().then(setConfig);
  }, []);

  /** The API names platforms `linkedin`/`x`/`facebook`/`tiktok`. */
  const isUnavailable = (id: Platform) => config != null && config[id.toLowerCase()] === false;

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
              {PLATFORMS.map((p) => {
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
                          ? t('unavailableDescription')
                          : t.rich(`platforms.${p.key}Description`, { bdi })}
                      </p>
                    </div>
                    {!unavailable && (
                      <ChevronRight className="w-4 h-4 text-moss-muted group-hover:text-moss transition-colors rtl:rotate-180" />
                    )}
                  </button>
                );
              })}

              {/* Instagram coming soon */}
              <div className="flex items-center gap-4 rounded-2xl border border-dashed border-rule bg-chalk p-4 opacity-70">
                <div className="w-11 h-11 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                  <span className="text-lg">📸</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-moss-muted">{t('instagramLabel')}</p>
                  <p className="text-xs text-moss-muted mt-0.5">{t('instagramNote')}</p>
                </div>
                <span className="text-[10px] font-bold text-moss-muted bg-chalk-sunk rounded-full px-2 py-0.5">
                  {t('instagramBadge')}
                </span>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

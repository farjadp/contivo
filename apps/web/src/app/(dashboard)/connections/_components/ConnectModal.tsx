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

import { useState } from 'react';
import { X, Linkedin, Twitter, Facebook, Music2, Info, ChevronRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectModalProps {
  onClose: () => void;
  /** The workspace ID to embed in the OAuth state param so the callback knows which workspace to connect. */
  workspaceId: string;
}

type Platform = 'LINKEDIN' | 'X' | 'FACEBOOK' | 'TIKTOK';

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS: {
  id: Platform;
  label: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  Icon: React.ElementType;
  scopes: string[];
}[] = [
  {
    id: 'LINKEDIN',
    label: 'LinkedIn',
    description: 'Publish text posts and articles to your LinkedIn profile or company page.',
    color: '#0A66C2',
    bg: '#EFF7FF',
    border: '#BFDBFE',
    Icon: Linkedin,
    scopes: ['w_member_social', 'r_basicprofile'],
  },
  {
    id: 'X',
    label: 'X (Twitter)',
    description: 'Post tweets and threads to your X account.',
    color: '#000000',
    bg: '#F0F0F0',
    border: '#E5E7EB',
    Icon: Twitter,
    scopes: ['tweet.write', 'tweet.read', 'users.read'],
  },
  {
    id: 'FACEBOOK',
    label: 'Facebook Page',
    description: 'Publish posts and link shares to a Facebook Page you manage.',
    color: '#1877F2',
    bg: '#EEF4FF',
    border: '#BFDBFE',
    Icon: Facebook,
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
  },
  {
    id: 'TIKTOK',
    label: 'TikTok',
    description: 'Publish photo carousel posts and videos to your TikTok account.',
    color: '#010101',
    bg: '#F0F0F0',
    border: '#E5E7EB',
    Icon: Music2,
    scopes: ['video.publish', 'video.upload'],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectModal({ onClose, workspaceId }: ConnectModalProps) {
  const [selected, setSelected] = useState<Platform | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  const platform = PLATFORMS.find((p) => p.id === selected);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-[#121212]">Connect a Social Account</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {selected ? 'Review permissions and connect' : 'Choose a platform to connect'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
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
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className="w-full flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition-all text-left group"
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: p.bg }}
                    >
                      <PIcon className="w-5 h-5" style={{ color: p.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-[#121212]">{p.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{p.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-700 transition-colors" />
                  </button>
                );
              })}

              {/* Instagram coming soon */}
              <div className="flex items-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 opacity-70">
                <div className="w-11 h-11 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                  <span className="text-lg">📸</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-600">Instagram Business</p>
                  <p className="text-xs text-gray-400 mt-0.5">Coming in Phase 2 — requires media pipeline.</p>
                </div>
                <span className="text-[10px] font-bold text-gray-400 bg-gray-200 rounded-full px-2 py-0.5">Soon</span>
              </div>
            </div>
          ) : (
            /* Platform detail + OAuth CTA */
            <div>
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-[#2B2DFF] font-semibold hover:underline mb-4 block"
              >
                ← Back to platform list
              </button>

              <div
                className="flex items-center gap-3 rounded-2xl p-4 mb-4"
                style={{ background: platform!.bg, border: `1px solid ${platform!.border}` }}
              >
                {(() => { const SelectedIcon = platform!.Icon; return (
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                  <SelectedIcon className="w-5 h-5" style={{ color: platform!.color }} />
                </div>); })()}
                <div>
                  <p className="text-sm font-bold text-[#121212]">{platform!.label}</p>
                  <p className="text-xs text-gray-500">{platform!.description}</p>
                </div>
              </div>

              {/* Permissions */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Permissions requested</p>
                <div className="space-y-1.5">
                  {platform!.scopes.map((scope) => (
                    <div key={scope} className="flex items-center gap-2 text-xs text-gray-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#2B2DFF]" />
                      <code className="font-mono">{scope}</code>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security note */}
              <div className="flex gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 mb-5">
                <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Your access token is encrypted and stored securely. It is never exposed to the frontend.
                  You can revoke access at any time.
                </p>
              </div>

              {/* CTA — real OAuth redirect to NestJS backend */}
              <a
                href={`${API_BASE}/api/v1/social/oauth/${selected!.toLowerCase()}/connect?workspaceId=${encodeURIComponent(workspaceId)}`}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 active:scale-[0.99] transition-all"
                style={{ backgroundColor: platform!.color }}
              >
                Continue to {platform!.label} OAuth →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

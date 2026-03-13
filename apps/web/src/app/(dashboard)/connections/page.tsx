/**
 * app/(dashboard)/connections/page.tsx
 *
 * Connections page — manages social media account connections and publish jobs.
 *
 * Top-level structure:
 *   - Page header with description
 *   - Two main tabs: Websites | Social Channels
 *   - Social Channels has 4 sub-tabs via SocialChannelsTab component
 *
 * Data is fetched server-side at render time.
 * Connection and job actions are handled via server actions (revalidate on change).
 */

import { redirect } from 'next/navigation';
import { Share2, Globe } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { SocialChannelsTab } from './_components/SocialChannelsTab';

export const metadata = { title: 'Connections — Contivo' };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Server-side data fetch ───────────────────────────────────────────────────

async function fetchConnections(workspaceId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/social/connections?workspaceId=${workspaceId}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { connections: [], total: 0 };
    return res.json() as Promise<{
      connections: Array<{
        id: string; platform: string; accountName: string; accountIdentifier: string;
        status: string; isDefault: boolean; lastSyncAt: string | null; createdAt: string;
      }>;
      total: number;
    }>;
  } catch {
    return { connections: [], total: 0 };
  }
}

async function fetchPublishJobs(workspaceId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/social/publish-jobs?workspaceId=${workspaceId}&limit=100`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { jobs: [], total: 0 };
    return res.json() as Promise<{
      jobs: Array<{
        id: string; platform: string; status: string; scheduledAtUtc: string | null;
        externalPostUrl: string | null; lastError: string | null;
        retryCount: number; createdAt: string; publishedAtUtc: string | null;
      }>;
      total: number;
    }>;
  } catch {
    return { jobs: [], total: 0 };
  }
}

// ─── Page Props ───────────────────────────────────────────────────────────────

type Props = {
  searchParams: Promise<{ tab?: string; workspaceId?: string }>;
};

// ─── Page Component ───────────────────────────────────────────────────────────

export default async function ConnectionsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const params = await searchParams;
  const activeMainTab = params.tab === 'websites' ? 'websites' : 'social';

  // Use workspaceId from query param or fall back to userId as workspace scope
  const workspaceId = params.workspaceId ?? session.userId ?? '';

  // Fetch data in parallel
  const [{ connections }, { jobs }] = await Promise.all([
    fetchConnections(workspaceId),
    fetchPublishJobs(workspaceId),
  ]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pt-8 px-4">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#121212]">Connections</h1>
        <p className="text-gray-500 mt-2 text-sm">
          Connect your brand's social channels and websites. Publish and schedule content directly from Contivo.
        </p>
      </div>

      {/* ─── Main tabs: Websites | Social Channels ──────────────────────── */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-fit">
        {[
          { id: 'social',   label: 'Social Channels', href: '/connections?tab=social',   Icon: Share2 },
          { id: 'websites', label: 'Websites',         href: '/connections?tab=websites', Icon: Globe },
        ].map(({ id, label, href, Icon }) => (
          <a
            key={id}
            href={href}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
              activeMainTab === id
                ? 'bg-white text-[#2B2DFF] shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </a>
        ))}
      </div>

      {/* ─── Tab content ────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-6">
        {activeMainTab === 'social' ? (
          <SocialChannelsTab
            accounts={connections}
            jobs={jobs}
            workspaceId={workspaceId}
          />
        ) : (
          /* Websites tab — placeholder for Phase 2 */
          <div className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Globe className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-[#121212]">Website connections</h3>
            <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
              Connect your website or blog for direct publishing via RSS, webhooks, or CMS integrations.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-gray-400 bg-gray-100 rounded-full px-3 py-1.5">
              Coming in Phase 2
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

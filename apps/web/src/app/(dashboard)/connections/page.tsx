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
import Link from 'next/link';
import { Share2, Globe } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { SocialChannelsTab } from './_components/SocialChannelsTab';
import { SitesSection } from './_components/SitesSection';
import { listSites } from '@/app/actions/sites';
import {
  getPublishJobs,
  getSocialConnections,
  resolveWorkspaceScope,
} from '@/lib/social-data';

export const metadata = { title: 'Connections — Contivo' };

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

  // Resolve a REAL workspace. This used to fall back to session.userId, which
  // is not a workspace id — every social action then failed with
  // "Workspace not found", including the Connect button.
  const { workspaces, workspace } = await resolveWorkspaceScope(
    session.userId as string,
    params.workspaceId,
  );
  const workspaceId = workspace?.id ?? '';

  const [connections, jobs, siteState] = await Promise.all([
    workspaceId ? getSocialConnections(workspaceId) : Promise.resolve([]),
    workspaceId ? getPublishJobs(workspaceId) : Promise.resolve([]),
    listSites(),
  ]);
  const sites = 'sites' in siteState ? siteState.sites : [];
  const siteWorkspaces = 'workspaces' in siteState ? siteState.workspaces : [];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return (
    <div className="max-w-5xl mx-auto space-y-8 pt-8 px-4">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#121212]">Connections</h1>
        <p className="text-gray-500 mt-2 text-sm">
          Connect your brand&apos;s social channels and websites. Publish and schedule content directly from Contivo.
        </p>
      </div>

      {/* ─── No workspace yet ───────────────────────────────────────────── */}
      {!workspace && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-base font-bold text-[#121212]">Create a workspace first</h2>
          <p className="text-sm text-amber-800 mt-1">
            Connections belong to a workspace — it decides which brand&apos;s content gets
            published. Create one in the Growth Engine, then come back.
          </p>
          <Link
            href="/growth/new"
            className="inline-block mt-4 rounded-xl bg-[#121212] text-white text-sm font-semibold px-4 py-2"
          >
            Create workspace
          </Link>
        </div>
      )}

      {/* ─── Workspace switcher (only when there is a choice) ───────────── */}
      {workspaces.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-400">
            Workspace
          </span>
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={`/connections?tab=${activeMainTab}&workspaceId=${w.id}`}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                w.id === workspaceId
                  ? 'bg-[#121212] text-white border-[#121212]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
              )}
            >
              {w.name}
            </Link>
          ))}
        </div>
      )}

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
          <SitesSection sites={sites} workspaces={siteWorkspaces} appUrl={appUrl} />
        )}
      </div>
    </div>
  );
}

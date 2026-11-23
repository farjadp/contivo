/**
 * app/[locale]/(dashboard)/connections/page.tsx
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

import { redirect, Link } from '@/i18n/navigation';
import { Share2, Globe } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/auth';
import { LAST_WORKSPACE_COOKIE } from '@/lib/last-workspace';
import { cn } from '@/lib/utils';
import { ConnectResumeBanner } from './_components/ConnectResumeBanner';
import { RememberWorkspace } from './_components/RememberWorkspace';
import { SocialChannelsTab } from './_components/SocialChannelsTab';
import { SitesSection } from './_components/SitesSection';
import { listSites } from '@/app/actions/sites';
import { finalizeSocialConnect } from '@/app/actions/social-connect';
import { connectReturnHref, parseConnectedPlatform } from '@/lib/connect-return';
import {
  getPublishJobs,
  getSocialConnections,
  resolveWorkspaceScope,
} from '@/lib/social-data';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'connections' });
  return { title: t('metaTitle') };
}

// ─── Page Props ───────────────────────────────────────────────────────────────

type Props = {
  searchParams: Promise<{ tab?: string; workspaceId?: string; pending?: string; connect?: string; error?: string }>;
};

// ─── Page Component ───────────────────────────────────────────────────────────

export default async function ConnectionsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const t = await getTranslations('connections');

  const params = await searchParams;

  // Back from a platform's consent screen: confirm the parked connection as
  // the signed-in user, then drop the one-time ticket from the URL so a
  // reload, a shared link or a Referer never carries it.
  //
  // Land on the workspace the account was connected to (B17). Without it the
  // page fell back to the oldest workspace, and "Account connected" appeared
  // next to that workspace's own, possibly expired, connection.
  if (params.pending) {
    const { result, workspaceId: connectedTo, platform } = await finalizeSocialConnect(params.pending);
    // Connected, and we know where: back to that workspace's setup chain,
    // which shows the one next step. Only a workspace this user owns — the
    // API's answer is a hint, the lookup is the check.
    if (result === 'ok' && connectedTo) {
      const { workspace: owned } = await resolveWorkspaceScope(session.userId as string, connectedTo, undefined);
      if (owned?.id === connectedTo) {
        redirect({ href: connectReturnHref(connectedTo, parseConnectedPlatform(platform)), locale: await getLocale() });
      }
    }
    redirect({
      href: {
        pathname: '/connections',
        query: connectedTo
          ? { tab: 'social', connect: result, workspaceId: connectedTo }
          : { tab: 'social', connect: result },
      },
      locale: await getLocale(),
    });
  }
  // ?error=<code> comes straight from the API callback (denied, expired,
  // replayed, platform failure). The code itself is only for logs/support.
  const connectResult =
    params.connect === 'ok' || params.connect === 'foreign' || params.connect === 'failed'
      ? params.connect
      : params.error
        ? 'failed'
        : null;
  const activeMainTab = params.tab === 'websites' ? 'websites' : 'social';

  // Resolve a REAL workspace. This used to fall back to session.userId, which
  // is not a workspace id — every social action then failed with
  // "Workspace not found", including the Connect button.
  // Without a workspaceId in the URL (the top bar's Connections link, or a
  // connect that came back with an error), open on the workspace the
  // customer was last in, not the oldest one (B2).
  const lastWorkspaceId = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const { workspaces, workspace } = await resolveWorkspaceScope(
    session.userId as string,
    params.workspaceId,
    lastWorkspaceId,
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
        <h1 className="text-3xl font-bold tracking-tight text-moss">{t('title')}</h1>
        <p className="text-moss-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      {/* ─── Result of a social connect ──────────────────────────────────── */}
      {connectResult && (
        <div
          role="status"
          className={cn(
            'rounded-2xl border p-4 text-sm',
            connectResult === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-amber-200 bg-amber-50 text-amber-900',
          )}
        >
          {t(`connectResult.${connectResult}`)}
        </div>
      )}

      {workspace && <RememberWorkspace workspaceId={workspace.id} />}

      {/* ─── A LinkedIn connect that never came back (B13) ─────────────── */}
      {workspace && <ConnectResumeBanner hasResult={connectResult != null} />}

      {/* ─── No workspace yet ───────────────────────────────────────────── */}
      {!workspace && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-base font-bold text-moss">{t('noWorkspace.title')}</h2>
          <p className="text-sm text-amber-800 mt-1">{t('noWorkspace.body')}</p>
          <Link
            href="/growth/new"
            className="inline-block mt-4 rounded-xl bg-moss text-chalk text-sm font-semibold px-4 py-2"
          >
            {t('noWorkspace.cta')}
          </Link>
        </div>
      )}

      {/* ─── Workspace switcher (only when there is a choice) ───────────── */}
      {workspaces.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-moss-muted">
            {t('workspaceLabel')}
          </span>
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={{ pathname: '/connections', query: { tab: activeMainTab, workspaceId: w.id } }}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                w.id === workspaceId
                  ? 'bg-moss text-chalk border-moss'
                  : 'bg-chalk-raised text-moss-muted border-rule hover:border-rule-strong',
              )}
            >
              {w.name}
            </Link>
          ))}
        </div>
      )}

      {/* ─── Main tabs: Websites | Social Channels ──────────────────────── */}
      {/*
        These were plain <a href="/connections?tab=…"> elements, which drop the
        visitor out of /fa on the first click. The locale-aware Link keeps the
        prefix and the workspace selection.
      */}
      <div className="flex gap-1 p-1 bg-chalk-sunk rounded-2xl w-fit">
        {(
          [
            { id: 'social', label: t('tabs.social'), Icon: Share2 },
            { id: 'websites', label: t('tabs.websites'), Icon: Globe },
          ] as const
        ).map(({ id, label, Icon }) => (
          <Link
            key={id}
            href={{
              pathname: '/connections',
              query: workspaceId ? { tab: id, workspaceId } : { tab: id },
            }}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
              activeMainTab === id
                ? 'bg-chalk-raised text-moss-700 shadow-sm'
                : 'text-moss-muted hover:text-moss',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </div>

      {/* ─── Tab content ────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-rule bg-chalk-raised shadow-sm p-6">
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

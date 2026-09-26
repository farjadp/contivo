import { Link, redirect } from '@/i18n/navigation';
import {
  ArrowUpRight,
  ExternalLink,
  Lightbulb,
  LineChart,
  ListTodo,
  Package,
  Plus,
  Sparkles,
  Tags,
  TrendingUp,
} from 'lucide-react';
import { getSession } from '@/lib/auth';
import { listWorkspaceArchiveStates } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('growth.index');
  return { title: t('metaTitle') };
}

export default async function GrowthEnginePage() {
  const t = await getTranslations('growth.index');
  const format = await getFormatter();
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const workspaces = await prisma.workspace.findMany({
    where: { userId: session.userId as string },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          contentItems: true,
          competitors: true,
        },
      },
    },
  });

  const archiveStates = await listWorkspaceArchiveStates(workspaces.map((workspace) => workspace.id));
  const visibleWorkspaces = workspaces.filter((workspace) => !archiveStates.get(workspace.id)?.isArchived);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="rounded-3xl border border-rule bg-gradient-to-br from-chalk-raised via-chalk-raised to-chalk p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-moss mb-1">{t('title')}</h1>
            <p className="text-moss-muted text-sm max-w-2xl">
              {t('subtitle')}
            </p>
          </div>
          <Link
            href={"/growth/new" as any}
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-moss text-chalk px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-moss hover:scale-[1.02] hover:shadow-xl transition-all"
          >
            <Plus className="w-4 h-4" />
            {t('newWorkspace')}
          </Link>
        </div>

        <div className="mt-4 rounded-xl border border-rule bg-chalk-sunk px-4 py-3 text-xs text-moss">
          {t('rowHint')}
        </div>
      </div>

      {/* Workspace Rows / Empty State */}
      {visibleWorkspaces.length === 0 ? (
        <div>
        <div className="rounded-2xl border-2 border-dashed border-rule bg-chalk-raised flex flex-col items-center justify-center p-16 text-center">
          <div className="w-12 h-12 bg-chalk-sunk rounded-xl flex items-center justify-center mb-4 text-moss-muted">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-moss mb-1">{t('empty.title')}</h2>
          <p className="text-sm text-moss-muted max-w-sm mb-6 leading-relaxed">
            {t('empty.body')}
          </p>
          <Link
            href={"/growth/new" as any}
            className="inline-flex items-center gap-2 bg-moss text-chalk px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-moss hover:scale-[1.02] transition-all"
          >
            <Plus className="w-4 h-4" />
            {t('empty.cta')}
          </Link>
        </div>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleWorkspaces.map((workspace) => {
            const brand = (workspace.brandSummary as Record<string, any>) || {};
            const insights = (workspace.audienceInsights as Record<string, any>) || {};
            const isReady = workspace.status === 'READY';
            const pillarsCount = brand.pillars?.length || 0;
            const matricesCount = Array.isArray(insights.competitiveMatrices?.charts)
              ? insights.competitiveMatrices.charts.length
              : 0;
            const keywordCompetitors = Array.isArray(insights.competitorKeywordsIntel?.competitors)
              ? insights.competitorKeywordsIntel.competitors.length
              : 0;
            const offeringsCount = Array.isArray(insights.productsServicesIntel?.client_offerings?.offerings)
              ? insights.productsServicesIntel.client_offerings.offerings.length
              : 0;

            /*
              The cards carry a message key and the number that goes into it,
              never a finished sentence: a template literal built here could
              only ever be English.
            */
            const featureCards = [
              {
                key: 'pipeline',
                icon: ListTodo,
                href: `/growth/${workspace.id}?tab=pipeline`,
                count: workspace._count.contentItems,
              },
              {
                key: 'ideation',
                icon: Lightbulb,
                href: `/growth/${workspace.id}?tab=ideation`,
                count: 0,
              },
              {
                key: 'strategy',
                icon: Sparkles,
                href: `/growth/${workspace.id}?tab=strategy`,
                count: pillarsCount,
              },
              {
                key: 'matrices',
                icon: LineChart,
                href: `/growth/${workspace.id}?tab=matrices`,
                count: matricesCount,
              },
              {
                key: 'keywords',
                icon: Tags,
                href: `/growth/${workspace.id}?tab=keywords`,
                count: keywordCompetitors,
              },
              {
                key: 'offerings',
                icon: Package,
                href: `/growth/${workspace.id}?tab=offerings`,
                count: offeringsCount,
              },
            ];

            return (
              <div
                key={workspace.id}
                className="group relative overflow-hidden rounded-3xl border border-rule bg-gradient-to-r from-chalk-raised via-chalk-raised to-chalk p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-moss hover:shadow-xl"
              >
                <div className="pointer-events-none absolute -end-10 -top-10 h-44 w-44 rounded-full bg-chalk-sunk/30 blur-3xl transition-opacity group-hover:opacity-80" />

                <div className="relative grid gap-5 xl:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.55fr)_auto]">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-moss flex items-center justify-center text-chalk font-bold uppercase shrink-0 shadow-sm">
                        {workspace.name.substring(0, 2)}
                      </div>
                      {isReady ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss-700 uppercase">
                          <Sparkles className="h-3 w-3" /> {t('statusActive')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-amber-700 uppercase">
                          {t('statusDraft')}
                        </span>
                      )}
                    </div>

                    <div>
                      <Link href={{ pathname: '/growth/[id]', params: { id: workspace.id } }}>
                        <h3
                          className="font-black text-xl text-moss line-clamp-1 hover:text-moss transition-colors"
                          title={workspace.name}
                        >
                          {workspace.name}
                        </h3>
                      </Link>
                      <div className="mt-1 flex items-center text-xs text-moss font-semibold hover:text-moss w-fit">
                        <ExternalLink className="me-1 h-3 w-3" />
                        {/* A domain read right-to-left is unreadable, so the
                            Latin run is isolated rather than flowing. */}
                        <span className="truncate max-w-[220px]" dir="ltr">
                          {workspace.websiteUrl?.replace(/^https?:\/\//, '') || t('noUrl')}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label={t('statCompetitors')} value={format.number(workspace._count.competitors)} />
                      <MiniStat label={t('statContentItems')} value={format.number(workspace._count.contentItems)} />
                    </div>

                    {brand.industry ? (
                      <p className="text-xs text-moss-muted">
                        <span className="font-semibold text-moss">{t('industry')}</span> {brand.industry}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {featureCards.map((feature) => {
                      const Icon = feature.icon;
                      return (
                        <Link
                          key={`${workspace.id}:${feature.key}`}
                          href={feature.href as any}
                          className="rounded-xl border border-rule bg-chalk-raised/95 px-3 py-3 transition hover:border-rule-strong hover:bg-chalk-sunk/50"
                        >
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-2 text-xs font-bold text-moss">
                              <Icon className="h-4 w-4 text-moss-700" />
                              {t(`cards.${feature.key}Title`)}
                            </span>
                            {/* Mirrored rather than rotated: rotating an
                                up-right arrow points it down-left. */}
                            <ArrowUpRight className="h-3.5 w-3.5 text-moss-muted rtl:-scale-x-100" />
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-moss-muted line-clamp-3">
                            {t(`cards.${feature.key}Desc`, { count: feature.count })}
                          </p>
                        </Link>
                      );
                    })}
                  </div>

                  <div className="flex xl:flex-col items-center xl:items-stretch gap-2">
                    <Link
                      href={{ pathname: '/growth/[id]', params: { id: workspace.id } }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-xs font-bold text-chalk hover:bg-moss transition-colors"
                    >
                      {t('openWorkspace')}
                    </Link>
                    <Link
                      href={{ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'matrices' } }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-rule-strong bg-chalk-raised px-4 py-2.5 text-xs font-bold text-moss hover:bg-chalk transition-colors"
                    >
                      {t('openStrategy')}
                    </Link>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rule bg-chalk-raised px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-moss-muted">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-moss">{value}</p>
    </div>
  );
}

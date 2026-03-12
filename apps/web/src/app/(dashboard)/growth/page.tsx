import Link from 'next/link';
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
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Growth Engine' };

export default async function GrowthEnginePage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

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

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white via-white to-gray-50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#121212] mb-1">Growth Engine</h1>
            <p className="text-gray-500 text-sm max-w-2xl">
              Your AI-powered strategy workspaces. Each row includes direct entry to every internal module with a quick explanation.
            </p>
          </div>
          <Link
            href={"/growth/new" as any}
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#121212] text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-black hover:scale-[1.02] hover:shadow-xl transition-all"
          >
            <Plus className="w-4 h-4" />
            New Workspace
          </Link>
        </div>

        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
          هر ورک‌اسپیس در یک ردیف نمایش داده می‌شود. داخل همان ردیف می‌توانید مستقیماً وارد هر تب داخلی شوید.
        </div>
      </div>

      {/* Workspace Rows / Empty State */}
      {workspaces.length === 0 ? (
        <div>
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white flex flex-col items-center justify-center p-16 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-4 text-gray-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#121212] mb-1">No workspaces yet</h2>
          <p className="text-sm text-gray-500 max-w-sm mb-6 leading-relaxed">
            Create your first Growth Engine workspace. Tell us about your brand and we'll build a tailored content strategy in seconds.
          </p>
          <Link
            href={"/growth/new" as any}
            className="inline-flex items-center gap-2 bg-[#121212] text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-black hover:scale-[1.02] transition-all"
          >
            <Plus className="w-4 h-4" />
            Initialize Workspace
          </Link>
        </div>
        </div>
      ) : (
        <div className="space-y-5">
          {workspaces.map((workspace) => {
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

            const featureCards = [
              {
                key: 'pipeline',
                title: 'Content Pipeline',
                icon: ListTodo,
                href: `/growth/${workspace.id}?tab=pipeline`,
                description: `${workspace._count.contentItems} content item tracked for planning, draft and execution.`,
              },
              {
                key: 'ideation',
                title: 'Ideation Station',
                icon: Lightbulb,
                href: `/growth/${workspace.id}?tab=ideation`,
                description: 'Generate campaign angles and turn ideas into publish-ready content fast.',
              },
              {
                key: 'strategy',
                title: 'Brand Memory',
                icon: Sparkles,
                href: `/growth/${workspace.id}?tab=strategy`,
                description: `${pillarsCount} content pillar captured from website voice and positioning.`,
              },
              {
                key: 'matrices',
                title: 'Market Matrices',
                icon: LineChart,
                href: `/growth/${workspace.id}?tab=matrices`,
                description: `${matricesCount} competitive chart generated for positioning and differentiation.`,
              },
              {
                key: 'keywords',
                title: 'Competitor Keywords',
                icon: Tags,
                href: `/growth/${workspace.id}?tab=keywords`,
                description: `${keywordCompetitors} competitor analyzed for keyword clusters and content strategy gaps.`,
              },
              {
                key: 'offerings',
                title: 'Products & Services',
                icon: Package,
                href: `/growth/${workspace.id}?tab=offerings`,
                description: `${offeringsCount} client offering mapped for comparison against market offers.`,
              },
            ];

            return (
              <div
                key={workspace.id}
                className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-r from-white via-white to-gray-50 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#121212] hover:shadow-xl"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-indigo-100/30 blur-3xl transition-opacity group-hover:opacity-80" />

                <div className="relative grid gap-5 xl:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.55fr)_auto]">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-[#121212] flex items-center justify-center text-white font-bold uppercase shrink-0 shadow-sm">
                        {workspace.name.substring(0, 2)}
                      </div>
                      {isReady ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-emerald-700 uppercase">
                          <Sparkles className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-amber-700 uppercase">
                          Draft
                        </span>
                      )}
                    </div>

                    <div>
                      <Link href={`/growth/${workspace.id}`}>
                        <h3
                          className="font-black text-xl text-[#121212] line-clamp-1 hover:text-indigo-700 transition-colors"
                          title={workspace.name}
                        >
                          {workspace.name}
                        </h3>
                      </Link>
                      <div className="mt-1 flex items-center text-xs text-indigo-700 font-semibold hover:text-indigo-800 w-fit">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        <span className="truncate max-w-[220px]">
                          {workspace.websiteUrl?.replace(/^https?:\/\//, '') || 'No URL'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Competitors" value={workspace._count.competitors} />
                      <MiniStat label="Content Items" value={workspace._count.contentItems} />
                    </div>

                    {brand.industry ? (
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold text-[#121212]">Industry:</span> {brand.industry}
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
                          className="rounded-xl border border-gray-200 bg-white/95 px-3 py-3 transition hover:border-indigo-300 hover:bg-indigo-50/50"
                        >
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-2 text-xs font-bold text-[#121212]">
                              <Icon className="h-4 w-4 text-indigo-600" />
                              {feature.title}
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 text-gray-400" />
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-gray-600 line-clamp-3">
                            {feature.description}
                          </p>
                        </Link>
                      );
                    })}
                  </div>

                  <div className="flex xl:flex-col items-center xl:items-stretch gap-2">
                    <Link
                      href={`/growth/${workspace.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#121212] px-4 py-2.5 text-xs font-bold text-white hover:bg-black transition-colors"
                    >
                      Open Workspace
                    </Link>
                    <Link
                      href={`/growth/${workspace.id}?tab=matrices`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-xs font-bold text-[#121212] hover:bg-gray-50 transition-colors"
                    >
                      Open Strategy
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

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-[#121212]">{value.toLocaleString()}</p>
    </div>
  );
}

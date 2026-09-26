import { useTranslations } from 'next-intl';
import { Layers3, Sparkles, UserCircle2 } from 'lucide-react';
import type { BrandAssetsPayload } from '@/app/actions/growth-brand-assets';
import { BrandAssetsManager } from './BrandAssetsManager';
import { RescrapeManager } from './RescrapeManager';

export function BrandMemoryTab({
  workspace,
  maxRescrapeRuns,
}: {
  workspace: any;
  maxRescrapeRuns: number;
}) {
  const t = useTranslations('tabsA.brandMemory');
  const brand = (workspace.brandSummary as any) || {};
  const brandAssets = ((workspace.audienceInsights as any)?.brandAssets as BrandAssetsPayload) || null;
  const toneList: string[] = String(brand.tone || '')
    .split(',')
    .map((item: string) => item.trim())
    .filter((item: string) => item && !['home', 'loading'].includes(item.toLowerCase()));
  const pillarList: string[] = Array.isArray(brand.pillars)
    ? brand.pillars
        .map((item: unknown) => String(item || '').trim())
        .filter((item: string) => item && !['home', 'loading'].includes(item.toLowerCase()))
    : [];
  const summaryReady = Boolean(brand.businessSummary && String(brand.businessSummary).trim().length >= 30);
  const valueReady = Boolean(brand.valueProposition && String(brand.valueProposition).trim().length >= 12);
  const audienceReady = Boolean(brand.persona?.description || brand.audience);
  const pendingAssets = brandAssets
    ? Object.values(brandAssets.brand_assets).reduce(
        (acc, list) => acc + list.filter((asset) => asset.status === 'pending_review').length,
        0,
      )
    : 0;
  const approvedAssets = brandAssets
    ? Object.values(brandAssets.brand_assets).reduce(
        (acc, list) => acc + list.filter((asset) => asset.status === 'approved').length,
        0,
      )
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="overflow-hidden rounded-[2rem] border border-rule bg-chalk-raised shadow-sm">
        <div className="border-b border-rule bg-gradient-to-r from-chalk/70 to-chalk-raised p-6 md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="inline-flex items-center gap-2 rounded-full border border-rule bg-chalk-raised px-3 py-1 text-xs font-semibold text-moss">
                <Sparkles className="h-3.5 w-3.5" />
                {t('badge')}
              </p>
              <h2 className="text-xl font-bold tracking-tight text-moss">{t('title')}</h2>
              <p className="max-w-3xl text-sm text-moss-muted">{t('body')}</p>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-chalk-raised px-3 py-1 text-[11px] font-semibold text-moss">
                  <Layers3 className="h-3.5 w-3.5" />
                  {t('assetsCount', { count: brandAssets?.summary.asset_count || 0 })}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800">
                  {t('pendingCount', { count: pendingAssets })}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-chalk-sunk px-3 py-1 text-[11px] font-semibold text-moss">
                  {t('approvedCount', { count: approvedAssets })}
                </span>
              </div>
            </div>

            <div className="min-w-[250px]">
              <RescrapeManager workspace={workspace} maxRuns={maxRescrapeRuns} />
            </div>
          </div>
        </div>

        <div className="p-6 md:p-7">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatusCard title={t('businessSummary')} ready={summaryReady} readyLabel={t('ready')} pendingLabel={t('needsReview')} />
            <StatusCard title={t('valueProposition')} ready={valueReady} readyLabel={t('ready')} pendingLabel={t('needsReview')} />
            <StatusCard title={t('audienceClarity')} ready={audienceReady} readyLabel={t('ready')} pendingLabel={t('needsReview')} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-rule bg-chalk-raised p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{t('businessSummary')}</p>
              <p className="mt-2 text-sm leading-relaxed text-moss">
                {brand.businessSummary || t('noSummary')}
              </p>
            </article>

            <article className="rounded-2xl border border-rule bg-chalk-sunk/60 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-moss">{t('valueProposition')}</p>
              <p className="mt-2 text-sm leading-relaxed text-moss">
                {brand.valueProposition || t('noValueProposition')}
              </p>
            </article>

            <article className="rounded-2xl border border-rule bg-chalk-raised p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{t('targetAudience')}</p>
              <div className="mt-2 space-y-2">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-moss">
                  <UserCircle2 className="h-4 w-4 text-moss-muted" />
                  {brand.persona?.title || t('personaFallback')}
                </p>
                <p className="text-sm leading-relaxed text-moss-muted">
                  {brand.persona?.description || brand.audience || t('noAudience')}
                </p>
              </div>
            </article>

            <article className="rounded-2xl border border-rule bg-chalk-raised p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{t('brandTone')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {toneList.length > 0 ? (
                  toneList.map((tone: string, index: number) => (
                    <span
                      key={`${tone}-${index}`}
                      className="inline-flex items-center rounded-full border border-rule bg-chalk-sunk px-3 py-1 text-xs font-semibold uppercase tracking-wide text-moss-700"
                    >
                      {tone}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-moss-muted">{t('toneNotSpecified')}</span>
                )}
              </div>
            </article>
          </div>

          <article className="mt-4 rounded-2xl border border-rule bg-chalk-raised p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{t('pillarsTitle')}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pillarList.length > 0 ? (
                pillarList.map((pillar: string, idx: number) => (
                  <div key={`${pillar}-${idx}`} className="rounded-xl border border-rule bg-chalk px-3 py-3">
                    <p className="text-xs font-semibold text-moss-muted">{t('pillarLabel', { index: idx + 1 })}</p>
                    <p className="mt-1 text-sm font-semibold text-moss">{pillar}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-moss-muted">{t('noPillars')}</p>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-rule bg-chalk-raised shadow-sm p-5 md:p-6">
        <BrandAssetsManager
          workspaceId={workspace.id}
          initialPayload={brandAssets}
          workspaceWebsiteUrl={workspace.websiteUrl}
        />
      </section>
    </div>
  );
}

function StatusCard({
  title,
  ready,
  readyLabel,
  pendingLabel,
}: {
  title: string;
  ready: boolean;
  readyLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="rounded-xl border border-rule bg-chalk-raised px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{title}</p>
      <p className={`mt-1 text-sm font-semibold ${ready ? 'text-moss-700' : 'text-amber-700'}`}>
        {ready ? readyLabel : pendingLabel}
      </p>
    </div>
  );
}

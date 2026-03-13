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
      <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50/70 to-white p-6 md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                <Sparkles className="h-3.5 w-3.5" />
                Brand Memory
              </p>
              <h2 className="text-xl font-bold tracking-tight text-[#121212]">Brand Foundation & Knowledge Layer</h2>
              <p className="max-w-3xl text-sm text-gray-600">
                This section keeps your brand context stable across strategy, content, and design. AI drafts the first
                version from your website, then your team confirms and improves it.
              </p>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-700">
                  <Layers3 className="h-3.5 w-3.5" />
                  {brandAssets?.summary.asset_count || 0} assets
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800">
                  {pendingAssets} pending review
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                  {approvedAssets} approved
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
            <StatusCard title="Business Summary" ready={summaryReady} />
            <StatusCard title="Value Proposition" ready={valueReady} />
            <StatusCard title="Audience Clarity" ready={audienceReady} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Business Summary</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                {brand.businessSummary || 'No summary available.'}
              </p>
            </article>

            <article className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-700">Value Proposition</p>
              <p className="mt-2 text-sm leading-relaxed text-indigo-900">
                {brand.valueProposition || 'No value proposition defined.'}
              </p>
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Target Audience</p>
              <div className="mt-2 space-y-2">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#121212]">
                  <UserCircle2 className="h-4 w-4 text-gray-500" />
                  {brand.persona?.title || 'General Audience'}
                </p>
                <p className="text-sm leading-relaxed text-gray-600">
                  {brand.persona?.description || brand.audience || 'No audience details provided.'}
                </p>
              </div>
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Brand Tone</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {toneList.length > 0 ? (
                  toneList.map((tone: string, index: number) => (
                    <span
                      key={`${tone}-${index}`}
                      className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700"
                    >
                      {tone}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">Not specified</span>
                )}
              </div>
            </article>
          </div>

          <article className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Core Content Pillars</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pillarList.length > 0 ? (
                pillarList.map((pillar: string, idx: number) => (
                  <div key={`${pillar}-${idx}`} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                    <p className="text-xs font-semibold text-gray-500">Pillar {idx + 1}</p>
                    <p className="mt-1 text-sm font-semibold text-[#121212]">{pillar}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No pillars defined.</p>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm p-5 md:p-6">
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
}: {
  title: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{title}</p>
      <p className={`mt-1 text-sm font-semibold ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>
        {ready ? 'Ready' : 'Needs Review'}
      </p>
    </div>
  );
}

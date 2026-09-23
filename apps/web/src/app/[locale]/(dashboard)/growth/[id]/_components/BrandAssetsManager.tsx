'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CheckCircle2,
  FileText,
  Globe,
  ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  Type,
  Upload,
  Users,
} from 'lucide-react';

import {
  generateWorkspaceBrandAssets,
  saveWorkspaceBrandAssetsEdits,
  type BrandAsset,
  type BrandAssetsPayload,
} from '@/app/actions/growth-brand-assets';

type CategoryKey = keyof BrandAssetsPayload['brand_assets'];

/* Keys and icons only; the label and the one-line description of each
   category are user-facing and come from the catalogue. */
const CATEGORY_TABS: Array<{
  key: CategoryKey | 'overview';
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'overview', icon: Sparkles },
  { key: 'visual_identity', icon: Palette },
  { key: 'messaging', icon: FileText },
  { key: 'voice_and_tone', icon: Tag },
  { key: 'products_and_services', icon: Globe },
  { key: 'audience', icon: Users },
  { key: 'strategy_assets', icon: Sparkles },
  { key: 'uploaded_files', icon: Upload },
];

const OVERVIEW_CATEGORIES: CategoryKey[] = [
  'visual_identity',
  'messaging',
  'voice_and_tone',
  'products_and_services',
  'audience',
  'strategy_assets',
  'uploaded_files',
];

const ASSET_STATUSES = ['pending_review', 'approved', 'rejected'] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function createManualAsset(category: CategoryKey): BrandAsset {
  const now = nowIso();
  const typeFallback = category === 'uploaded_files' ? 'reference_file' : 'brand_note';
  return {
    id: crypto.randomUUID(),
    asset_type: typeFallback,
    asset_category: category,
    title: '',
    content: '',
    source: category === 'uploaded_files' ? 'uploaded' : 'manual',
    source_url: '',
    confidence_score: 1,
    status: 'approved',
    is_primary: false,
    created_at: now,
    updated_at: now,
  };
}

function byStatusCount(payload: BrandAssetsPayload, status: BrandAsset['status']): number {
  return Object.values(payload.brand_assets).reduce(
    (acc, list) => acc + list.filter((asset) => asset.status === status).length,
    0,
  );
}

function looksLikeUrl(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeWebsiteUrl(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (looksLikeUrl(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function resolveAssetUrl(raw: string, websiteUrl: string | null | undefined): string {
  const source = String(raw || '').trim();
  if (!source) return '';
  if (looksLikeUrl(source)) return source;
  if (source.startsWith('//')) return `https:${source}`;
  if (source.startsWith('data:')) return '';

  const base = normalizeWebsiteUrl(websiteUrl);
  if (!base) return '';
  try {
    return new URL(source, base).toString();
  } catch {
    return '';
  }
}

function extractFirstUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (looksLikeUrl(raw)) return raw;
  const match = raw.match(/https?:\/\/[^\s"')]+/i);
  return match?.[0] || '';
}

function extractColorValue(asset: BrandAsset): string {
  const bucket = `${asset.content} ${asset.title} ${asset.source_url}`.toLowerCase();
  const hex = bucket.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[0];
  if (!hex) return '#111827';
  if (hex.length === 4) {
    const [r, g, b] = [hex[1], hex[2], hex[3]];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return hex.toLowerCase();
}

function inferVisualKind(asset: BrandAsset): 'logo' | 'color' | 'font' | 'other' {
  const bucket = `${asset.asset_type} ${asset.title} ${asset.content}`.toLowerCase();
  if (bucket.includes('logo') || bucket.includes('favicon')) return 'logo';
  if (bucket.includes('color') || bucket.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)) return 'color';
  if (bucket.includes('font') || bucket.includes('typography')) return 'font';
  return 'other';
}

function extractImageUrl(asset: BrandAsset, websiteUrl: string | null | undefined): string {
  const direct = extractFirstUrl(asset.source_url);
  if (direct) return direct;

  const resolved = resolveAssetUrl(asset.source_url, websiteUrl);
  if (resolved) return resolved;

  const fromContent = extractFirstUrl(asset.content);
  if (fromContent) return fromContent;

  const hintedPath = `${asset.content} ${asset.title}`.match(/logo_asset:\s*([^\s,;]+)/i)?.[1] || '';
  return resolveAssetUrl(hintedPath, websiteUrl);
}

export function BrandAssetsManager({
  workspaceId,
  initialPayload,
  workspaceWebsiteUrl,
}: {
  workspaceId: string;
  initialPayload: BrandAssetsPayload | null;
  workspaceWebsiteUrl?: string | null;
}) {
  const t = useTranslations('tabsB.brandAssets');
  const format = useFormatter();
  const [payload, setPayload] = useState<BrandAssetsPayload | null>(initialPayload);
  const [activeTab, setActiveTab] = useState<CategoryKey | 'overview'>('overview');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const currentAssets = useMemo(() => {
    if (!payload || activeTab === 'overview') return [];
    const source = payload.brand_assets[activeTab] || [];
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (asset) =>
        asset.title.toLowerCase().includes(q) ||
        asset.content.toLowerCase().includes(q) ||
        asset.asset_type.toLowerCase().includes(q),
    );
  }, [payload, activeTab, query]);

  const visualGroups = useMemo(() => {
    if (activeTab !== 'visual_identity') {
      return {
        logos: [] as BrandAsset[],
        colors: [] as BrandAsset[],
        fonts: [] as BrandAsset[],
        others: [] as BrandAsset[],
      };
    }
    const logos: BrandAsset[] = [];
    const colors: BrandAsset[] = [];
    const fonts: BrandAsset[] = [];
    const others: BrandAsset[] = [];

    for (const asset of currentAssets) {
      const kind = inferVisualKind(asset);
      if (kind === 'logo') logos.push(asset);
      else if (kind === 'color') colors.push(asset);
      else if (kind === 'font') fonts.push(asset);
      else others.push(asset);
    }

    return { logos, colors, fonts, others };
  }, [activeTab, currentAssets]);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateWorkspaceBrandAssets(workspaceId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.payload) {
        setPayload(result.payload as BrandAssetsPayload);
        setSuccess(t('refreshed'));
      }
    } catch (actionError) {
      console.error(actionError);
      setError(t('refreshFailed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const save = async () => {
    if (!payload) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await saveWorkspaceBrandAssetsEdits(workspaceId, payload);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.payload) {
        setPayload(result.payload as BrandAssetsPayload);
        setSuccess(t('saved'));
      }
    } catch (actionError) {
      console.error(actionError);
      setError(t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateCategoryAssets = (category: CategoryKey, next: BrandAsset[]) => {
    if (!payload) return;
    const nextPayload: BrandAssetsPayload = {
      ...payload,
      generated_at: nowIso(),
      source: 'MANUAL',
      summary: {
        ...payload.summary,
        asset_count: Object.entries(payload.brand_assets).reduce((acc, [key, list]) => {
          if (key === category) return acc + next.length;
          return acc + list.length;
        }, 0),
      },
      brand_assets: {
        ...payload.brand_assets,
        [category]: next,
      },
    };
    setPayload(nextPayload);
  };

  const updateAsset = (
    category: CategoryKey,
    assetId: string,
    patch: Partial<BrandAsset>,
  ) => {
    if (!payload) return;
    const source = payload.brand_assets[category] || [];
    const next = source.map((asset) =>
      asset.id === assetId
        ? {
            ...asset,
            ...patch,
            updated_at: nowIso(),
          }
        : asset,
    );
    updateCategoryAssets(category, next);
  };

  const removeAsset = (category: CategoryKey, assetId: string) => {
    if (!payload) return;
    const source = payload.brand_assets[category] || [];
    const next = source.filter((asset) => asset.id !== assetId);
    updateCategoryAssets(category, next);
  };

  const addAsset = (category: CategoryKey) => {
    if (!payload) return;
    const source = payload.brand_assets[category] || [];
    updateCategoryAssets(category, [createManualAsset(category), ...source]);
  };

  const addVisualAsset = (kind: 'logo' | 'color' | 'font') => {
    if (!payload) return;
    const source = payload.brand_assets.visual_identity || [];
    const base = createManualAsset('visual_identity');
    const seeded: BrandAsset = {
      ...base,
      asset_type: kind === 'font' ? 'font' : kind === 'color' ? 'color' : 'logo',
      title:
        kind === 'font'
          ? t('seedFontTitle')
          : kind === 'color'
            ? t('seedColorTitle')
            : t('seedLogoTitle'),
      content: kind === 'color' ? '#2563eb' : '',
      source_url: '',
      status: 'approved',
      source: 'manual',
      confidence_score: 1,
    };
    updateCategoryAssets('visual_identity', [seeded, ...source]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
              <Sparkles className="h-3.5 w-3.5" />
              {t('badge')}
            </p>
            <h3 className="text-lg font-bold text-[#121212]">{t('title')}</h3>
            <p className="max-w-2xl text-sm text-gray-600">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-xl bg-[#121212] px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('refresh')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isSaving || !payload}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-[#121212] hover:bg-gray-50 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('save')}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {success}
          </span>
        </div>
      ) : null}

      {!payload ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-[#121212]">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-gray-500">
            {t.rich('emptyBody', {
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <StatCard label={t('statAssetCount')} value={format.number(payload.summary.asset_count)} />
            <StatCard
              label={t('statClarity')}
              value={format.number(payload.summary.brand_clarity_score)}
              suffix={`/${format.number(10)}`}
            />
            <StatCard label={t('statPending')} value={format.number(byStatusCount(payload, 'pending_review'))} />
            <StatCard label={t('statApproved')} value={format.number(byStatusCount(payload, 'approved'))} />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-2">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {CATEGORY_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                const count =
                  tab.key === 'overview'
                    ? payload.summary.asset_count
                    : payload.brand_assets[tab.key as CategoryKey]?.length || 0;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-xl border px-3 py-3 text-start transition ${
                      isActive
                        ? 'border-[#121212] bg-[#121212] text-white'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <p className="inline-flex items-center gap-2 text-xs font-bold">
                      <Icon className="h-4 w-4" />
                      {t(`tabs.${tab.key}`)}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${isActive ? 'bg-white/15' : 'bg-gray-100'}`}>
                        {format.number(count)}
                      </span>
                    </p>
                    <p className={`mt-1 text-[11px] ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                      {t(`tabDescriptions.${tab.key}`)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === 'overview' ? (
            <div className="grid gap-3 md:grid-cols-2">
              {OVERVIEW_CATEGORIES.map((key) => (
                <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                    {t(`tabs.${key}`)}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {t('overviewCount', {
                      assets: format.number(payload.brand_assets[key].length),
                      pending: format.number(
                        payload.brand_assets[key].filter((item) => item.status === 'pending_review')
                          .length,
                      ),
                    })}
                  </p>
                </div>
              ))}
            </div>
          ) : activeTab === 'visual_identity' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('searchVisual')}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none md:max-w-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addVisualAsset('logo')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      {t('addLogo')}
                    </button>
                    <button
                      type="button"
                      onClick={() => addVisualAsset('color')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <Palette className="h-3.5 w-3.5" />
                      {t('addColor')}
                    </button>
                    <button
                      type="button"
                      onClick={() => addVisualAsset('font')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <Type className="h-3.5 w-3.5" />
                      {t('addFont')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <StatCard label={t('statLogos')} value={format.number(visualGroups.logos.length)} />
                <StatCard label={t('statColors')} value={format.number(visualGroups.colors.length)} />
                <StatCard label={t('statTypography')} value={format.number(visualGroups.fonts.length)} />
                <StatCard label={t('statOther')} value={format.number(visualGroups.others.length)} />
              </div>

              <section className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{t('logosHeading')}</p>
                {visualGroups.logos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
                    {t('noLogos')}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visualGroups.logos.map((asset) => {
                      const imageUrl = extractImageUrl(asset, workspaceWebsiteUrl);
                      return (
                        <details key={asset.id} className="rounded-xl border border-gray-200 bg-white">
                          <summary className="flex list-none cursor-pointer items-center justify-between gap-3 px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                                {imageUrl ? (
                                  <img src={imageUrl} alt={asset.title || t('untitledLogo')} className="h-full w-full object-contain" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-gray-400">
                                    <ImageIcon className="h-6 w-6" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#121212]">
                                  <bdi>{asset.title || t('untitledLogo')}</bdi>
                                </p>
                                <p className="truncate text-xs text-gray-500">{t('clickToEdit')}</p>
                              </div>
                            </div>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                              {t(`status.${asset.status}`)}
                            </span>
                          </summary>
                          <div className="border-t border-gray-100 p-4">
                            <div className="grid gap-3 md:grid-cols-2">
                              <Field label={t('fieldLogoName')}>
                                <input
                                  value={asset.title}
                                  onChange={(event) => updateAsset('visual_identity', asset.id, { title: event.target.value })}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                              </Field>
                              <Field label={t('fieldStatus')}>
                                <select
                                  value={asset.status}
                                  onChange={(event) =>
                                    updateAsset('visual_identity', asset.id, {
                                      status: event.target.value as BrandAsset['status'],
                                    })
                                  }
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                >
    
                                </select>
                              </Field>
                              <Field label={t('fieldImageUrl')} full>
                                <input
                                  value={asset.source_url}
                                  onChange={(event) =>
                                    updateAsset('visual_identity', asset.id, { source_url: event.target.value })
                                  }
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                  placeholder="https://..."
                                />
                              </Field>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={asset.is_primary}
                                  onChange={(event) =>
                                    updateAsset('visual_identity', asset.id, { is_primary: event.target.checked })
                                  }
                                />
                                {t('markPrimaryLogo')}
                              </label>
                              <button
                                type="button"
                                onClick={() => removeAsset('visual_identity', asset.id)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {t('remove')}
                              </button>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{t('paletteHeading')}</p>
                {visualGroups.colors.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
                    {t('noColors')}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {visualGroups.colors.map((asset) => {
                      const color = extractColorValue(asset);
                      return (
                        <div key={asset.id} className="rounded-xl border border-gray-200 bg-white p-3">
                          <div className="h-24 rounded-lg border border-gray-200" style={{ backgroundColor: color }} />
                          <div className="mt-3 space-y-2">
                            <input
                              value={asset.title}
                              onChange={(event) => updateAsset('visual_identity', asset.id, { title: event.target.value })}
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-[#121212]"
                              placeholder={t('colorNamePlaceholder')}
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={color}
                                onChange={(event) => updateAsset('visual_identity', asset.id, { content: event.target.value })}
                                className="h-10 w-12 cursor-pointer rounded border border-gray-300 bg-white p-1"
                              />
                              <select
                                value={asset.status}
                                onChange={(event) =>
                                  updateAsset('visual_identity', asset.id, {
                                    status: event.target.value as BrandAsset['status'],
                                  })
                                }
                                className="h-10 flex-1 rounded-md border border-gray-300 px-2 text-xs"
                              >
                                {ASSET_STATUSES.map((key) => (
                                  <option key={key} value={key}>
                                    {t(`status.${key}`)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={asset.is_primary}
                                  onChange={(event) =>
                                    updateAsset('visual_identity', asset.id, { is_primary: event.target.checked })
                                  }
                                />
                                {t('primary')}
                              </label>
                              <button
                                type="button"
                                onClick={() => removeAsset('visual_identity', asset.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                              >
                                <Trash2 className="h-3 w-3" />
                                {t('remove')}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{t('typographyHeading')}</p>
                {visualGroups.fonts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
                    {t('noFonts')}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visualGroups.fonts.map((asset) => (
                      <div key={asset.id} className="rounded-xl border border-gray-200 bg-white p-4">
                        <input
                          value={asset.title}
                          onChange={(event) => updateAsset('visual_identity', asset.id, { title: event.target.value })}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold"
                          placeholder={t('fontLabelPlaceholder')}
                        />
                        <textarea
                          value={asset.content}
                          onChange={(event) => updateAsset('visual_identity', asset.id, { content: event.target.value })}
                          className="mt-2 h-16 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder={t('fontNotePlaceholder')}
                        />
                        <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                          {/* A specimen line: it has to be in the reader's own
                              script, or it shows nothing about the font. */}
                          {t('fontSample')}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                            <input
                              type="checkbox"
                              checked={asset.is_primary}
                              onChange={(event) =>
                                updateAsset('visual_identity', asset.id, { is_primary: event.target.checked })
                              }
                            />
                            {t('primary')}
                          </label>
                          <button
                            type="button"
                            onClick={() => removeAsset('visual_identity', asset.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="h-3 w-3" />
                            {t('remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('searchAssets')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none md:max-w-sm"
                />
                <button
                  type="button"
                  onClick={() => addAsset(activeTab as CategoryKey)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('addManual')}
                </button>
              </div>

              {currentAssets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
                  {t('noAssets')}
                </div>
              ) : (
                <div className="space-y-3">
                  {currentAssets.map((asset) => (
                    <details key={asset.id} className="rounded-xl border border-gray-200 bg-white" open>
                      <summary className="flex list-none cursor-pointer items-center justify-between gap-2 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#121212]">
                            <bdi>{asset.title || t('untitledAsset')}</bdi>
                          </p>
                          {/* asset_type is a stored identifier, not copy. */}
                          <p className="truncate text-xs text-gray-500"><bdi>{asset.asset_type}</bdi></p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                            {t(`status.${asset.status}`)}
                          </span>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            {format.number(asset.confidence_score, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      </summary>
                      <div className="border-t border-gray-100 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label={t('fieldTitle')}>
                            <input
                              value={asset.title}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, { title: event.target.value })
                              }
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                          </Field>
                          <Field label={t('fieldAssetType')}>
                            <input
                              value={asset.asset_type}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, { asset_type: event.target.value })
                              }
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                          </Field>
                          <Field label={t('fieldContent')} full>
                            <textarea
                              value={asset.content}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, { content: event.target.value })
                              }
                              className="h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                          </Field>
                          <Field label={t('fieldSourceUrl')}>
                            <input
                              value={asset.source_url}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, { source_url: event.target.value })
                              }
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              placeholder="https://..."
                            />
                          </Field>
                          <Field label={t('fieldStatus')}>
                            <select
                              value={asset.status}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, {
                                  status: event.target.value as BrandAsset['status'],
                                })
                              }
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                              {ASSET_STATUSES.map((key) => (
                                <option key={key} value={key}>
                                  {t(`status.${key}`)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={t('fieldConfidence')}>
                            <input
                              type="number"
                              step={0.01}
                              min={0.3}
                              max={1}
                              value={Number(asset.confidence_score.toFixed(2))}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, {
                                  confidence_score: Math.max(0.3, Math.min(1, Number(event.target.value) || 0.3)),
                                })
                              }
                              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                          </Field>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                            <input
                              type="checkbox"
                              checked={asset.is_primary}
                              onChange={(event) =>
                                updateAsset(activeTab as CategoryKey, asset.id, { is_primary: event.target.checked })
                              }
                            />
                            {t('markPrimary')}
                          </label>
                          <button
                            type="button"
                            onClick={() => removeAsset(activeTab as CategoryKey, asset.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('remove')}
                          </button>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'uploaded_files' ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
              <p className="font-semibold">{t('uploadNoteTitle')}</p>
              <p className="mt-1">{t('uploadNoteBody')}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
}: {
  label: string;
  /** Already run through the request formatter. */
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#121212]">
        {value}
        {suffix || ''}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={full ? 'space-y-1.5 md:col-span-2' : 'space-y-1.5'}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}

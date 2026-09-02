'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Copy, Globe, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { SiteApiGuide } from './SiteApiGuide';

import {
  createSite,
  deleteSite,
  rotateSiteKey,
  setSiteStatus,
  type SiteSummary,
} from '@/app/actions/sites';

type Props = {
  sites: SiteSummary[];
  workspaces: Array<{ id: string; name: string }>;
  appUrl: string;
};

export function SitesSection({ sites, workspaces, appUrl }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    workspaceId: workspaces[0]?.id ?? '',
    name: '',
    siteUrl: '',
    revalidateUrl: '',
    revalidateSecret: '',
  });
  const [freshKey, setFreshKey] = useState<{ siteName: string; key: string } | null>(null);
  const [error, setError] = useState('');
  const [isPending, start] = useTransition();

  const handleCreate = () => {
    setError('');
    start(async () => {
      const result = await createSite(form);
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('apiKey' in result && result.apiKey) {
        setFreshKey({ siteName: form.name, key: result.apiKey });
        setShowForm(false);
        setForm({ workspaceId: workspaces[0]?.id ?? '', name: '', siteUrl: '', revalidateUrl: '', revalidateSecret: '' });
        router.refresh();
      }
    });
  };

  const handleRotate = (site: SiteSummary) => {
    setError('');
    start(async () => {
      const result = await rotateSiteKey(site.id);
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('apiKey' in result && result.apiKey) {
        setFreshKey({ siteName: site.name, key: result.apiKey });
        router.refresh();
      }
    });
  };

  if (workspaces.length === 0) {
    return (
      <Empty
        title="No workspace yet"
        body="Create a Growth Engine workspace first — a site connection serves the content of one workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[#121212]">Websites</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Give a site an API key and it can pull its published posts from Contivo. Works with any
            stack — the site fetches, Contivo never pushes into your codebase.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-[#121212] text-white text-sm font-semibold hover:bg-black/80"
        >
          <Plus className="w-4 h-4" />
          Add site
        </button>
      </div>

      <SiteApiGuide appUrl={appUrl} />

      {freshKey && <FreshKeyCard siteName={freshKey.siteName} apiKey={freshKey.key} appUrl={appUrl} onDismiss={() => setFreshKey(null)} />}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Workspace" hint="Whose content this site serves.">
              <select
                className={inputCls}
                value={form.workspaceId}
                onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Site name">
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="farjadp.info"
              />
            </Field>
            <Field label="Site URL">
              <input
                className={inputCls}
                value={form.siteUrl}
                onChange={(e) => setForm((f) => ({ ...f, siteUrl: e.target.value }))}
                placeholder="https://www.farjadp.info"
              />
            </Field>
            <Field label="Revalidate URL (optional)" hint="Called after each publish so your site can clear its cache.">
              <input
                className={inputCls}
                value={form.revalidateUrl}
                onChange={(e) => setForm((f) => ({ ...f, revalidateUrl: e.target.value }))}
                placeholder="https://www.farjadp.info/api/revalidate"
              />
            </Field>
            <Field label="Revalidate secret (optional)" hint="Sent as a Bearer token to that URL.">
              <input
                className={inputCls}
                value={form.revalidateSecret}
                onChange={(e) => setForm((f) => ({ ...f, revalidateSecret: e.target.value }))}
                placeholder="a random string your site checks"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="px-4 py-2 rounded-xl bg-[#2B2DFF] text-white text-sm font-semibold disabled:opacity-60"
            >
              {isPending ? 'Creating…' : 'Create site & key'}
            </button>
          </div>
        </div>
      )}

      {sites.length === 0 && !showForm ? (
        <Empty
          title="No sites connected"
          body="Add a site to give it an API key. Autopilot can then write for the blog channel and your site will serve the posts."
        />
      ) : (
        <ul className="space-y-3">
          {sites.map((site) => (
            <li key={site.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="font-semibold text-[#121212]">{site.name}</span>
                    <StatusPill status={site.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 break-all">{site.siteUrl}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Workspace: {site.workspaceName}</span>
                    <span>{site.publishedCount} published</span>
                    <span className="font-mono">{site.keyPrefix}…</span>
                    {site.lastFetchedAt && <span>Last fetch: {formatDate(site.lastFetchedAt)}</span>}
                    {site.revalidateUrl && (
                      <span>
                        Revalidate:{' '}
                        {site.lastRevalidateStatus == null
                          ? 'not called yet'
                          : site.lastRevalidateStatus === 0
                            ? 'failed'
                            : `HTTP ${site.lastRevalidateStatus}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <IconButton title="Issue a new key (invalidates the current one)" onClick={() => handleRotate(site)} disabled={isPending}>
                    <RefreshCw className="w-4 h-4" />
                  </IconButton>
                  <IconButton
                    title={site.status === 'ACTIVE' ? 'Disable this key' : 'Re-enable this key'}
                    onClick={() =>
                      start(async () => {
                        await setSiteStatus(site.id, site.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                        router.refresh();
                      })
                    }
                    disabled={isPending}
                  >
                    <KeyRound className="w-4 h-4" />
                  </IconButton>
                  <IconButton
                    title="Delete this site"
                    danger
                    onClick={() =>
                      start(async () => {
                        await deleteSite(site.id);
                        router.refresh();
                      })
                    }
                    disabled={isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FreshKeyCard({
  siteName,
  apiKey,
  appUrl,
  onDismiss,
}: {
  siteName: string;
  apiKey: string;
  appUrl: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<'key' | 'snippet' | null>(null);
  const snippet = `const res = await fetch("${appUrl}/api/v1/posts", {
  headers: { Authorization: \`Bearer \${process.env.CONTIVO_API_KEY}\` },
  next: { revalidate: 300 },
});
const { posts } = await res.json();`;

  const copy = async (text: string, which: 'key' | 'snippet') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-[#2B2DFF] bg-[#2B2DFF]/5 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-[#121212]">API key for {siteName}</h4>
          <p className="text-sm text-gray-600 mt-1">
            Copy it now — this is the only time it is shown. Contivo stores only a hash, so it
            cannot be shown again. Lost it? Rotate to issue a new one.
          </p>
        </div>
        <button onClick={onDismiss} className="text-sm font-semibold text-gray-500 shrink-0">
          Done
        </button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono break-all">
          {apiKey}
        </code>
        <button
          onClick={() => copy(apiKey, 'key')}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#121212] text-white text-xs font-semibold"
        >
          {copied === 'key' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied === 'key' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Fetch your posts
          </span>
          <button onClick={() => copy(snippet, 'snippet')} className="text-xs font-semibold text-[#2B2DFF]">
            {copied === 'snippet' ? 'Copied' : 'Copy snippet'}
          </button>
        </div>
        <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto">
          {snippet}
        </pre>
        <p className="text-xs text-gray-500 mt-2">
          Store the key as <code className="font-mono">CONTIVO_API_KEY</code> on your site — server-side
          only. Single post: <code className="font-mono">/api/v1/posts/&lt;slug&gt;</code>
        </p>
      </div>
    </div>
  );
}

const inputCls =
  'block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-black focus:outline-none focus:ring-1 focus:ring-black';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-lg border border-gray-200 disabled:opacity-50 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    DISABLED: 'bg-gray-100 text-gray-700',
    REVOKED: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${styles[status] ?? styles.DISABLED}`}>
      {status}
    </span>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-14 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <Globe className="w-6 h-6 text-gray-400" />
      </div>
      <h3 className="text-base font-bold text-[#121212]">{title}</h3>
      <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">{body}</p>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

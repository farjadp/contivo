'use client';

/**
 * How to actually use a site key.
 *
 * The key was shown once at creation with a two-line snippet and then never
 * explained again, so anyone returning to this tab had a credential and no
 * idea what to do with it. Everything here is checked against the real
 * handlers in app/api/v1/posts — the field list is what `serializePost`
 * returns, not what a plausible blog API would return.
 *
 * The wording lives in the `siteApi.guide` namespace, beside the public
 * reference at /docs/site-api, so the two say the same thing in both
 * languages. Snippets, field names and status codes are never translated:
 * they are the literal wire format.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, Copy } from 'lucide-react';

import { Link } from '@/i18n/navigation';

const FIELDS = [
  'id',
  'slug',
  'title',
  'content',
  'excerpt',
  'channel',
  'publishedAt',
  'updatedAt',
] as const;

function Snippet({ label, code }: { label: string; code: string }) {
  const t = useTranslations('siteApi.guide');
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500">{label}</p>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2B2DFF] hover:opacity-80"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      {/* The snippet is Latin by nature: pinned LTR so an RTL shell cannot
          reorder its lines or push its punctuation to the wrong end. */}
      <pre
        dir="ltr"
        className="mt-1.5 overflow-x-auto rounded-xl bg-[#0B0F14] p-4 text-left text-[12px] leading-relaxed text-gray-200"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SiteApiGuide({ appUrl }: { appUrl: string }) {
  const t = useTranslations('siteApi.guide');
  const [open, setOpen] = useState(false);

  const list = `curl -H "Authorization: Bearer YOUR_SITE_KEY" \\
  "${appUrl}/api/v1/posts?limit=20"`;

  const nextjs = `// app/blog/page.tsx — Next.js App Router
async function getPosts() {
  const res = await fetch("${appUrl}/api/v1/posts?limit=20", {
    headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
    // Contivo pushes nothing to you; your site re-reads on this interval.
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(\`Contivo returned \${res.status}\`);
  const { posts } = await res.json();
  return posts;
}

export default async function BlogIndex() {
  const posts = await getPosts();
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>
          <a href={\`/blog/\${p.slug}\`}>{p.title}</a>
          <p>{p.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}`;

  const single = `// app/blog/[slug]/page.tsx
const res = await fetch("${appUrl}/api/v1/posts/" + params.slug, {
  headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  next: { revalidate: 300 },
});
if (res.status === 404) notFound();
const { post } = await res.json();
// post.content is Markdown — render it with your existing renderer.`;

  const paging = `let cursor = null;
const all = [];
do {
  const url = new URL("${appUrl}/api/v1/posts");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url, {
    headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  });
  const page = await res.json();
  all.push(...page.posts);
  cursor = page.nextCursor;   // null when there are no more pages
} while (cursor);`;

  /** The literal token a troubleshooting line is about, kept out of the prose. */
  const c = (chunks: React.ReactNode) => (
    <bdi className="font-mono text-[#121212]">{chunks}</bdi>
  );
  /** Same, for the line whose token was never given the darker ink. */
  const cp = (chunks: React.ReactNode) => <bdi className="font-mono">{chunks}</bdi>;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 p-5 text-start"
        aria-expanded={open}
      >
        <div>
          <p className="text-sm font-bold text-[#121212]">{t('toggleTitle')}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t('toggleBody')}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-6 border-t border-gray-100 p-5">
          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('step1Title')}</h4>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              {t.rich('step1Body', {
                code: (chunks) => (
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">{chunks}</code>
                ),
              })}
            </p>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('step2Title')}</h4>
            <Snippet label={t('step2Label')} code={list} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('step3Title')}</h4>
            <Snippet label={t('step3Label')} code={nextjs} />
            <p className="mt-2 text-xs leading-relaxed text-gray-600">{t('step3Body')}</p>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('step4Title')}</h4>
            <Snippet label={t('step4Label')} code={single} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('fieldsTitle')}</h4>
            <dl className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
              {FIELDS.map((name) => (
                <div key={name} className="grid grid-cols-[7.5rem_1fr] gap-3 px-3.5 py-2.5">
                  <dt className="font-mono text-[12px] text-[#121212]">
                    <bdi>{name}</bdi>
                  </dt>
                  <dd className="text-xs leading-relaxed text-gray-600">{t(`fields.${name}`)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('pagingTitle')}</h4>
            <Snippet label={t('pagingLabel')} code={paging} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">{t('troubleTitle')}</h4>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-gray-600">
              <li>{t.rich('trouble401', { c })}</li>
              <li>{t.rich('trouble404', { c })}</li>
              <li>{t.rich('troubleEmpty', { c: cp })}</li>
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-gray-500">{t('revalidateNote')}</p>

          <Link
            href="/docs/site-api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2B2DFF] hover:opacity-80"
          >
            {t('fullReference')}
            <span aria-hidden className="rtl:rotate-180">
              &rarr;
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

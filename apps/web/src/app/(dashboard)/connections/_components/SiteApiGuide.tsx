'use client';

/**
 * How to actually use a site key.
 *
 * The key was shown once at creation with a two-line snippet and then never
 * explained again, so anyone returning to this tab had a credential and no
 * idea what to do with it. Everything here is checked against the real
 * handlers in app/api/v1/posts — the field list is what `serializePost`
 * returns, not what a plausible blog API would return.
 */

import { useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';

const FIELDS: Array<[string, string]> = [
  ['id', 'Stable identifier. Use it as a React key, not in your URLs.'],
  ['slug', 'URL-safe, assigned at publish and never changed afterwards. Route on this.'],
  ['title', 'The post topic.'],
  ['content', 'The full body, as Markdown.'],
  ['excerpt', 'First ~200 characters, already stripped of Markdown. For cards and meta descriptions.'],
  ['channel', 'Always "blog" unless you asked for others.'],
  ['publishedAt', 'ISO 8601, or null if not published.'],
  ['updatedAt', 'ISO 8601. Useful for cache keys and sitemaps.'],
];

function Snippet({ label, code }: { label: string; code: string }) {
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
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mt-1.5 overflow-x-auto rounded-xl bg-[#0B0F14] p-4 text-[12px] leading-relaxed text-gray-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SiteApiGuide({ appUrl }: { appUrl: string }) {
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

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="text-sm font-bold text-[#121212]">How to use your site key</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Your site reads posts from Contivo. Nothing is pushed into your codebase, and there is
            no plugin to install.
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-6 border-t border-gray-100 p-5">
          <section>
            <h4 className="text-sm font-bold text-[#121212]">1 · Store the key as an env var</h4>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              It is shown once, when you create it. Put it in your hosting provider&apos;s
              environment as <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">CONTIVO_SITE_KEY</code>{' '}
              and never in client-side code — the key reads everything this workspace has published.
              Lost it? Create a new site connection; keys cannot be recovered.
            </p>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">2 · Check it works</h4>
            <Snippet label="From your terminal" code={list} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">3 · List posts on your site</h4>
            <Snippet label="Next.js App Router — server component" code={nextjs} />
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              Any framework works: it is one authenticated GET returning JSON. Call it server-side
              so the key never reaches the browser.
            </p>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">4 · Render one post</h4>
            <Snippet label="Single post by slug" code={single} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">What comes back</h4>
            <dl className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
              {FIELDS.map(([name, meaning]) => (
                <div key={name} className="grid grid-cols-[7.5rem_1fr] gap-3 px-3.5 py-2.5">
                  <dt className="font-mono text-[12px] text-[#121212]">{name}</dt>
                  <dd className="text-xs leading-relaxed text-gray-600">{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">More than 100 posts</h4>
            <Snippet label="Cursor paging" code={paging} />
          </section>

          <section>
            <h4 className="text-sm font-bold text-[#121212]">When something is wrong</h4>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-gray-600">
              <li>
                <span className="font-mono text-[#121212]">401</span> — the key is wrong, revoked,
                or the site connection is not active. Check the status above.
              </li>
              <li>
                <span className="font-mono text-[#121212]">404</span> on a single post — that slug
                is not published. Slugs are assigned at publish time, not when a draft is written.
              </li>
              <li>
                <span className="font-mono">posts: []</span> — the key is fine, nothing is published
                to the blog channel yet. Autopilot has to publish before anything appears here.
              </li>
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-gray-500">
            Optional: set a revalidate URL on the site connection and Contivo will ping it after
            each publish, so your cache refreshes immediately instead of on the next interval.
          </p>
        </div>
      )}
    </div>
  );
}

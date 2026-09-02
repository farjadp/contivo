/**
 * Content API reference.
 *
 * Public, linkable, and written from the actual handlers in app/api/v1/posts
 * and lib/site-api — every field, status code and header here was read out of
 * the code rather than assumed. Print styles are included so Cmd-P produces a
 * usable PDF without a separate export.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';

export const metadata: Metadata = {
  title: 'Content API — Contivo for developers',
  description:
    'Read your published Contivo posts from any stack with one authenticated GET. Endpoints, parameters, response shape, errors, caching and the revalidate webhook.',
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.contivo.app';

/* ─── Pieces ──────────────────────────────────────────────────────────────── */

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-16 scroll-mt-24 font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-semibold leading-[1.1] tracking-[-0.035em] first:mt-0"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-10 font-display text-[17px] font-semibold tracking-[-0.02em]">{children}</h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 max-w-[68ch] text-[15.5px] leading-[1.7] text-carbon-80">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-carbon/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-carbon">
      {children}
    </code>
  );
}

function Block({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="mt-4">
      {label && <figcaption className="mb-1.5 text-[12.5px] text-carbon-60">{label}</figcaption>}
      <pre className="overflow-x-auto border border-carbon/15 bg-carbon p-4 text-[12.5px] leading-relaxed text-paper-warm">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

function Table({ rows, head }: { rows: Array<[string, string, string]>; head: [string, string, string] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-carbon/20">
            {head.map((h, i) => (
              <th key={i} className="py-2.5 pr-6 text-[12px] font-semibold uppercase tracking-wide text-carbon-60">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a} className="border-b border-carbon/10 align-top">
              <td className="py-3 pr-6 font-mono text-[13px] text-carbon">{a}</td>
              <td className="py-3 pr-6 font-mono text-[12.5px] text-carbon-60">{b}</td>
              <td className="py-3 text-[14px] leading-relaxed text-carbon-80">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOC: Array<[string, string]> = [
  ['how-it-works', 'How it works'],
  ['auth', 'Authentication'],
  ['list', 'List posts'],
  ['single', 'Get one post'],
  ['post-object', 'The post object'],
  ['errors', 'Errors'],
  ['caching', 'Caching and freshness'],
  ['revalidate', 'Revalidate webhook'],
  ['recipes', 'Recipes'],
  ['limits', 'Limits and guarantees'],
];

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function SiteApiDocsPage() {
  return (
    <div className="theme-editorial min-h-screen bg-paper-warm font-sans text-carbon">
      <div className="print:hidden">
        <SiteNav />
      </div>

      <header className="border-b border-carbon/10">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-20">
          <h1 className="max-w-[20ch] font-display text-[clamp(2.4rem,6vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            Content API
          </h1>
          <p className="mt-6 max-w-[62ch] text-[17px] leading-[1.65] text-carbon-80">
            Your site reads its published posts from Contivo with one authenticated{' '}
            <Code>GET</Code>. Nothing is pushed into your codebase, there is no plugin, and it works
            with any stack that can make an HTTP request.
          </p>
          <p className="mt-4 text-[13px] text-carbon-60">
            Base URL <Code>{APP_URL}</Code> · read-only · JSON
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[92rem] gap-16 px-6 py-16 md:px-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Contents */}
        <nav aria-label="Contents" className="mb-12 lg:sticky lg:top-24 lg:mb-0 lg:self-start print:hidden">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-carbon-60">Contents</p>
          <ul className="mt-4 space-y-2.5 border-l border-carbon/15 pl-4">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-[14px] text-carbon-80 underline decoration-transparent underline-offset-4 transition-colors hover:text-carbon hover:decoration-brick"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          {/* ── How it works ───────────────────────────────────────────── */}
          <H2 id="how-it-works">How it works</H2>
          <P>
            Contivo writes and publishes on the schedule you set. When a post goes live it is
            assigned a permanent slug and marked published — and that is the end of Contivo&apos;s
            involvement. Your site asks for posts when it wants them.
          </P>
          <P>
            That direction matters: Contivo never has write access to your codebase, your deploy
            pipeline or your CMS. If you turn Contivo off, your site keeps serving whatever it last
            fetched.
          </P>

          {/* ── Auth ───────────────────────────────────────────────────── */}
          <H2 id="auth">Authentication</H2>
          <P>
            Every request carries a site key as a bearer token. Create one under{' '}
            <Link href="/connections" className="underline decoration-carbon/30 underline-offset-4 hover:decoration-brick">
              Connections → Websites
            </Link>
            . It is shown once, at creation, and cannot be recovered afterwards — if you lose it,
            create a new site connection.
          </P>
          <Block label="Every request">{`Authorization: Bearer ctv_your_site_key`}</Block>
          <P>
            <strong className="font-semibold text-carbon">Keep the key server-side.</strong> It can
            read everything this workspace has ever published. The endpoints do send permissive CORS
            headers, so a browser <em>can</em> call them — but doing so ships your key to every
            visitor. Fetch in a server component, a route handler, at build time, or from your
            backend.
          </P>

          {/* ── List ───────────────────────────────────────────────────── */}
          <H2 id="list">List posts</H2>
          <Block>{`GET ${APP_URL}/api/v1/posts`}</Block>
          <P>Returns published posts for the workspace that owns the key, newest first.</P>
          <Table
            head={['Parameter', 'Type', 'Meaning']}
            rows={[
              ['limit', '1–100, default 20', 'How many posts to return. Values outside the range are clamped, not rejected.'],
              ['cursor', 'string', 'The nextCursor from a previous response. Omit for the first page.'],
              ['channel', 'default "blog"', 'Which channel to return. Pass "all" to include social posts too — usually you do not want these on a website.'],
            ]}
          />
          <Block label="Response">{`{
  "posts": [
    {
      "id": "cmtj8m9cw0004669budmzpagu",
      "slug": "eliminating-the-triage-bottleneck",
      "title": "Eliminating the Triage Bottleneck",
      "content": "Manual bug triage remains a major source of friction…",
      "excerpt": "Manual bug triage remains a major source of friction for engineering teams…",
      "channel": "blog",
      "publishedAt": "2026-09-02T02:00:00.000Z",
      "updatedAt": "2026-09-02T02:00:04.118Z"
    }
  ],
  "nextCursor": "cmtj8m9cw0004669budmzpagu"
}`}</Block>
          <P>
            <Code>nextCursor</Code> is <Code>null</Code> when there are no more pages. That is the
            only reliable end-of-list signal — do not stop on a short page.
          </P>

          {/* ── Single ─────────────────────────────────────────────────── */}
          <H2 id="single">Get one post</H2>
          <Block>{`GET ${APP_URL}/api/v1/posts/{slug}`}</Block>
          <P>
            Returns <Code>{`{ "post": { … } }`}</Code> with the same object as above. Route your
            pages on <Code>slug</Code>, never on <Code>id</Code>: the slug is assigned once at
            publish and never changes, which is what keeps your URLs stable.
          </P>

          {/* ── Post object ────────────────────────────────────────────── */}
          <H2 id="post-object">The post object</H2>
          <Table
            head={['Field', 'Type', 'Notes']}
            rows={[
              ['id', 'string', 'Stable internal identifier. Good as a React key, not for URLs.'],
              ['slug', 'string', 'URL-safe, unique per workspace, permanent from the moment of publish.'],
              ['title', 'string', 'The post topic.'],
              ['content', 'string', 'The full body, as Markdown. Render it with whatever you already use.'],
              ['excerpt', 'string', 'First ~200 characters with Markdown stripped. For cards, lists and meta descriptions.'],
              ['channel', 'string', 'Normally "blog". Only other values if you asked for channel=all.'],
              ['publishedAt', 'string | null', 'ISO 8601 UTC.'],
              ['updatedAt', 'string', 'ISO 8601 UTC. Useful for cache keys, sitemaps and lastmod.'],
            ]}
          />

          {/* ── Errors ─────────────────────────────────────────────────── */}
          <H2 id="errors">Errors</H2>
          <Table
            head={['Status', 'Body error', 'What it means']}
            rows={[
              ['401', 'unauthorized', 'Missing, malformed, unknown or revoked key — or the site connection is not active. All four return the same response on purpose, so nobody can use this endpoint to work out which keys exist.'],
              ['404', 'not_found', 'Single post only. No published post with that slug in this workspace. A slug belonging to another customer also returns 404, never 403.'],
            ]}
          />
          <P>
            An empty <Code>posts</Code> array is <em>not</em> an error. It means the key is valid and
            nothing has been published to that channel yet — Autopilot has to publish something
            before anything appears here.
          </P>

          {/* ── Caching ────────────────────────────────────────────────── */}
          <H2 id="caching">Caching and freshness</H2>
          <P>
            Responses are sent with <Code>Cache-Control: no-store</Code>, so the API never asks a
            CDN or browser to hold onto them. Caching is entirely yours to decide, which is the right
            way round: your framework knows your traffic and your tolerance for staleness.
          </P>
          <Block label="Next.js — revalidate every five minutes">{`const res = await fetch("${APP_URL}/api/v1/posts", {
  headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  next: { revalidate: 300 },
});`}</Block>
          <P>
            A five-minute window is a sensible default. For instant updates, pair a long revalidate
            with the webhook below rather than polling harder.
          </P>

          {/* ── Revalidate ─────────────────────────────────────────────── */}
          <H2 id="revalidate">Revalidate webhook</H2>
          <P>
            Optional. Set a revalidate URL on the site connection and Contivo will call it right
            after each publish, so your cache clears immediately instead of on the next interval.
          </P>
          <Block label="What Contivo sends">{`POST <your revalidate URL>
Content-Type: application/json
Authorization: Bearer <your revalidate secret>   // only if you set one

{ "slug": "eliminating-the-triage-bottleneck", "event": "post.published" }`}</Block>
          <Block label="Next.js — app/api/revalidate/route.ts">{`import { revalidatePath } from "next/cache";

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== \`Bearer \${process.env.CONTIVO_REVALIDATE_SECRET}\`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { slug } = await req.json();
  revalidatePath("/blog");
  revalidatePath(\`/blog/\${slug}\`);
  return Response.json({ revalidated: true });
}`}</Block>
          <P>
            The call times out after 8 seconds and its status is recorded against the site
            connection. A failure is logged and never blocks the publish — the post is already live
            and your site will pick it up on its next scheduled fetch regardless.
          </P>

          {/* ── Recipes ────────────────────────────────────────────────── */}
          <H2 id="recipes">Recipes</H2>

          <H3>Check your key from a terminal</H3>
          <Block>{`curl -sS -H "Authorization: Bearer $CONTIVO_SITE_KEY" \\
  "${APP_URL}/api/v1/posts?limit=1" | jq`}</Block>

          <H3>Fetch every post, one page at a time</H3>
          <Block>{`async function allPosts(key) {
  const out = [];
  let cursor = null;
  do {
    const url = new URL("${APP_URL}/api/v1/posts");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: { Authorization: \`Bearer \${key}\` } });
    if (!res.ok) throw new Error(\`Contivo returned \${res.status}\`);

    const page = await res.json();
    out.push(...page.posts);
    cursor = page.nextCursor;      // null ends the loop
  } while (cursor);
  return out;
}`}</Block>

          <H3>Static site generation</H3>
          <Block label="Next.js — generateStaticParams">{`export async function generateStaticParams() {
  const res = await fetch("${APP_URL}/api/v1/posts?limit=100", {
    headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  });
  const { posts } = await res.json();
  return posts.map((p) => ({ slug: p.slug }));
}`}</Block>

          <H3>Python</H3>
          <Block>{`import os, requests

r = requests.get(
    "${APP_URL}/api/v1/posts",
    headers={"Authorization": f"Bearer {os.environ['CONTIVO_SITE_KEY']}"},
    params={"limit": 20},
    timeout=10,
)
r.raise_for_status()
for post in r.json()["posts"]:
    print(post["slug"], "-", post["title"])`}</Block>

          <H3>PHP / WordPress</H3>
          <Block>{`$response = wp_remote_get(
  '${APP_URL}/api/v1/posts?limit=20',
  ['headers' => ['Authorization' => 'Bearer ' . getenv('CONTIVO_SITE_KEY')]]
);
$posts = json_decode(wp_remote_retrieve_body($response), true)['posts'];`}</Block>

          {/* ── Limits ─────────────────────────────────────────────────── */}
          <H2 id="limits">Limits and guarantees</H2>
          <Table
            head={['Property', 'Value', 'Notes']}
            rows={[
              ['Methods', 'GET, OPTIONS', 'Read-only. There is no way to write content through this API.'],
              ['Page size', 'max 100', 'Larger values are clamped rather than rejected.'],
              ['Scope', 'one workspace', 'A key can only ever read the workspace it was created in.'],
              ['Slugs', 'permanent', 'Assigned at publish, never rewritten. Safe to use in URLs and sitemaps.'],
              ['Revoking', 'immediate', 'Deleting or disabling a site connection makes its key 401 on the next request.'],
            ]}
          />
          <P>
            There is no published rate limit today. Cache your responses anyway — a site that fetches
            on every page view is fragile for its own reasons, not just ours.
          </P>

          <hr className="mt-16 border-carbon/15" />
          <p className="mt-6 text-[13.5px] leading-relaxed text-carbon-60">
            Something here wrong or missing? It is generated from the same code that serves the API,
            so a mismatch is a bug worth reporting. Print this page to save it as a PDF.
          </p>
        </main>
      </div>

      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}

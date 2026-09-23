/**
 * Content API reference.
 *
 * Public, linkable, and written from the actual handlers in app/api/v1/posts
 * and lib/site-api — every field, status code and header here was read out of
 * the code rather than assumed. Print styles are included so Cmd-P produces a
 * usable PDF without a separate export.
 *
 * Only the prose is translated. Endpoints, headers, JSON field names, status
 * codes and every code sample stay Latin with Latin digits in both languages,
 * because they are the literal thing a reader has to type — a Persian ۴۰۱ or a
 * translated `nextCursor` would be a lie about the wire format. Code blocks
 * carry `dir="ltr"` so an RTL page cannot reorder them, and the mono cells that
 * hold identifiers are wrapped in `bdi` for the same reason.
 */

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'siteApi.meta' });

  return {
    title: t('title'),
    description: t('description'),
  };
}

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
      <pre
        dir="ltr"
        className="overflow-x-auto border border-carbon/15 bg-carbon p-4 text-left text-[12.5px] leading-relaxed text-paper-warm"
      >
        <code>{children}</code>
      </pre>
    </figure>
  );
}

function Table({ rows, head }: { rows: Array<[string, string, string]>; head: [string, string, string] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-start">
        <thead>
          <tr className="border-b border-carbon/20">
            {head.map((h, i) => (
              <th key={i} className="py-2.5 pe-6 text-[12px] font-semibold uppercase tracking-wide text-carbon-60">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a} className="border-b border-carbon/10 align-top">
              <td className="py-3 pe-6 font-mono text-[13px] text-carbon">
                <bdi>{a}</bdi>
              </td>
              <td className="py-3 pe-6 font-mono text-[12.5px] text-carbon-60">
                <bdi>{b}</bdi>
              </td>
              <td className="py-3 text-[14px] leading-relaxed text-carbon-80">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOC = [
  'how-it-works',
  'auth',
  'list',
  'single',
  'post-object',
  'errors',
  'caching',
  'revalidate',
  'recipes',
  'limits',
] as const;

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function SiteApiDocsPage() {
  const t = useTranslations('siteApi');

  /** Inline `<code>` inside a translated sentence, so a translator can move it. */
  const code = (chunks: React.ReactNode) => <Code>{chunks}</Code>;

  return (
    <div className="theme-editorial min-h-screen bg-paper-warm font-sans text-carbon">
      <div className="print:hidden">
        <SiteNav />
      </div>

      <header className="border-b border-carbon/10">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-20">
          <h1 className="max-w-[20ch] font-display text-[clamp(2.4rem,6vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            {t('title')}
          </h1>
          <p className="mt-6 max-w-[62ch] text-[17px] leading-[1.65] text-carbon-80">
            {t.rich('lede', { code })}
          </p>
          <p className="mt-4 text-[13px] text-carbon-60">
            {t('baseLabel')} <Code>{APP_URL}</Code> · {t('readOnly')} · JSON
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[92rem] gap-16 px-6 py-16 md:px-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Contents */}
        <nav aria-label={t('contents')} className="mb-12 lg:sticky lg:top-24 lg:mb-0 lg:self-start print:hidden">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-carbon-60">
            {t('contents')}
          </p>
          <ul className="mt-4 space-y-2.5 border-s border-carbon/15 ps-4">
            {TOC.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-[14px] text-carbon-80 underline decoration-transparent underline-offset-4 transition-colors hover:text-carbon hover:decoration-brick"
                >
                  {t(`toc.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          {/* ── How it works ───────────────────────────────────────────── */}
          <H2 id="how-it-works">{t('toc.how-it-works')}</H2>
          <P>{t('howItWorks.p1')}</P>
          <P>{t('howItWorks.p2')}</P>

          {/* ── Auth ───────────────────────────────────────────────────── */}
          <H2 id="auth">{t('toc.auth')}</H2>
          <P>
            {t.rich('auth.p1', {
              link: (chunks) => (
                <Link
                  href="/connections"
                  className="underline decoration-carbon/30 underline-offset-4 hover:decoration-brick"
                >
                  {chunks}
                </Link>
              ),
            })}
          </P>
          <Block label={t('auth.blockLabel')}>{`Authorization: Bearer ctv_your_site_key`}</Block>
          <P>
            {t.rich('auth.p2', {
              strong: (chunks) => <strong className="font-semibold text-carbon">{chunks}</strong>,
              em: (chunks) => <em>{chunks}</em>,
            })}
          </P>

          {/* ── List ───────────────────────────────────────────────────── */}
          <H2 id="list">{t('toc.list')}</H2>
          <Block>{`GET ${APP_URL}/api/v1/posts`}</Block>
          <P>{t('list.p1')}</P>
          <Table
            head={[t('list.head.name'), t('list.head.type'), t('list.head.meaning')]}
            rows={[
              ['limit', '1–100, default 20', t('list.limit')],
              ['cursor', 'string', t('list.cursor')],
              ['channel', 'default "blog"', t('list.channel')],
            ]}
          />
          <Block label={t('list.responseLabel')}>{`{
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
          <P>{t.rich('list.p2', { code })}</P>

          {/* ── Single ─────────────────────────────────────────────────── */}
          <H2 id="single">{t('toc.single')}</H2>
          <Block>{`GET ${APP_URL}/api/v1/posts/{slug}`}</Block>
          <P>
            {t.rich('single.p1', {
              code,
              /* The braces are built here rather than written into the message,
                 where ICU would read them as placeholders. The tag wraps the
                 one word that is actually a field name. */
              shape: (chunks) => <Code>{`{ "`}{chunks}{`": { … } }`}</Code>,
            })}
          </P>

          {/* ── Post object ────────────────────────────────────────────── */}
          <H2 id="post-object">{t('toc.post-object')}</H2>
          <Table
            head={[t('postObject.head.name'), t('postObject.head.type'), t('postObject.head.notes')]}
            rows={[
              ['id', 'string', t('postObject.id')],
              ['slug', 'string', t('postObject.slug')],
              ['title', 'string', t('postObject.title')],
              ['content', 'string', t('postObject.content')],
              ['excerpt', 'string', t('postObject.excerpt')],
              ['channel', 'string', t('postObject.channel')],
              ['publishedAt', 'string | null', t('postObject.publishedAt')],
              ['updatedAt', 'string', t('postObject.updatedAt')],
            ]}
          />

          {/* ── Errors ─────────────────────────────────────────────────── */}
          <H2 id="errors">{t('toc.errors')}</H2>
          <Table
            head={[t('errors.head.status'), t('errors.head.body'), t('errors.head.meaning')]}
            rows={[
              ['401', 'unauthorized', t('errors.unauthorized')],
              ['404', 'not_found', t('errors.notFound')],
            ]}
          />
          <P>
            {t.rich('errors.p1', {
              code,
              em: (chunks) => <em>{chunks}</em>,
            })}
          </P>

          {/* ── Caching ────────────────────────────────────────────────── */}
          <H2 id="caching">{t('toc.caching')}</H2>
          <P>{t.rich('caching.p1', { code })}</P>
          <Block label={t('caching.blockLabel')}>{`const res = await fetch("${APP_URL}/api/v1/posts", {
  headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  next: { revalidate: 300 },
});`}</Block>
          <P>{t('caching.p2')}</P>

          {/* ── Revalidate ─────────────────────────────────────────────── */}
          <H2 id="revalidate">{t('toc.revalidate')}</H2>
          <P>{t('revalidate.p1')}</P>
          <Block label={t('revalidate.sendsLabel')}>{`POST <your revalidate URL>
Content-Type: application/json
Authorization: Bearer <your revalidate secret>   // only if you set one

{ "slug": "eliminating-the-triage-bottleneck", "event": "post.published" }`}</Block>
          <Block label={t('revalidate.routeLabel')}>{`import { revalidatePath } from "next/cache";

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== \`Bearer \${process.env.CONTIVO_REVALIDATE_SECRET}\`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { slug } = await req.json();
  revalidatePath("/blog");
  revalidatePath(\`/blog/\${slug}\`);
  return Response.json({ revalidated: true });
}`}</Block>
          <P>{t('revalidate.p2')}</P>

          {/* ── Recipes ────────────────────────────────────────────────── */}
          <H2 id="recipes">{t('toc.recipes')}</H2>

          <H3>{t('recipes.curl')}</H3>
          <Block>{`curl -sS -H "Authorization: Bearer $CONTIVO_SITE_KEY" \\
  "${APP_URL}/api/v1/posts?limit=1" | jq`}</Block>

          <H3>{t('recipes.paging')}</H3>
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

          <H3>{t('recipes.ssg')}</H3>
          <Block label={t('recipes.ssgLabel')}>{`export async function generateStaticParams() {
  const res = await fetch("${APP_URL}/api/v1/posts?limit=100", {
    headers: { Authorization: \`Bearer \${process.env.CONTIVO_SITE_KEY}\` },
  });
  const { posts } = await res.json();
  return posts.map((p) => ({ slug: p.slug }));
}`}</Block>

          <H3>{t('recipes.python')}</H3>
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

          <H3>{t('recipes.php')}</H3>
          <Block>{`$response = wp_remote_get(
  '${APP_URL}/api/v1/posts?limit=20',
  ['headers' => ['Authorization' => 'Bearer ' . getenv('CONTIVO_SITE_KEY')]]
);
$posts = json_decode(wp_remote_retrieve_body($response), true)['posts'];`}</Block>

          {/* ── Limits ─────────────────────────────────────────────────── */}
          <H2 id="limits">{t('toc.limits')}</H2>
          <Table
            head={[t('limits.head.property'), t('limits.head.value'), t('limits.head.notes')]}
            rows={[
              [t('limits.methods'), t('limits.methodsValue'), t('limits.methodsNotes')],
              [t('limits.pageSize'), t('limits.pageSizeValue'), t('limits.pageSizeNotes')],
              [t('limits.scope'), t('limits.scopeValue'), t('limits.scopeNotes')],
              [t('limits.slugs'), t('limits.slugsValue'), t('limits.slugsNotes')],
              [t('limits.revoking'), t('limits.revokingValue'), t('limits.revokingNotes')],
            ]}
          />
          <P>{t('limits.p1')}</P>

          <hr className="mt-16 border-carbon/15" />
          <p className="mt-6 text-[13.5px] leading-relaxed text-carbon-60">{t('footerNote')}</p>
        </main>
      </div>

      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}

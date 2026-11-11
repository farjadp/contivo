# contivo.app blog — design

Date: 2026-11-11 · Branch: `feat/contivo-blog`

## Problem

Farjad wants three SEO/AIO/GEO articles a week on contivo.app, in English and
native Persian, written by `contivo-content-social-marketer` and published only
after he approves each one. contivo.app has no blog (`/en/blog` is a 404), so an
approved article has nowhere to go.

Contivo already sells a way for a website to show its blog: the Content API
(`/api/v1/posts`, `apps/web/src/lib/site-api`). contivo.app should use it like a
customer does. If our own blog breaks, the Content API is broken for customers too,
and we find out first.

## What exists

- `GET /api/v1/posts` and `GET /api/v1/posts/[slug]`, Bearer site key, scoped to the
  key's workspace, published `blog` items only. Payload: `id, slug, title, content
  (markdown), excerpt, channel, publishedAt, updatedAt`. No language, no author, no
  description field.
- `publisher.ts` sets the slug, flips the item to PUBLISHED and POSTs
  `{ slug, event: 'post.published' }` to the site connection's `revalidateUrl`
  with `Authorization: Bearer <revalidateSecret>`. Both are editable on the
  Connections page.
- Slugs come from `slugify(title)`. A Persian title slugifies to nothing, so a
  Persian post gets `post-<last 8 of id>`.
- A workspace has one `contentLanguage` (EN or FA).

## Options

### 1. How the site gets posts

| | Option | For | Against |
|---|---|---|---|
| **A** | Server-side HTTP to the Content API with a site key from an env var | Real dogfooding: the same auth, payload and revalidate ping a customer gets. No Prisma coupling in the page. | contivo-web calls itself over the public URL, so a Content API outage takes the blog down. That is the point. |
| B | Read `content_items` with Prisma in the page | No network hop | Not dogfooding. Skips auth and the serializer, so customer-facing bugs stay hidden. |
| C | Fetch from the browser | — | Leaks the key. Ruled out. |

**Pick A.**

### 2. Which locale a post belongs to

The API has no language field. Changing the schema would collide with the video
stream, which owns `schema.prisma` additions right now.

| | Option | For | Against |
|---|---|---|---|
| **A** | Detect from the text: a post whose letters are mostly Arabic-script is `fa`, otherwise `en`. One key. | No schema change, no second workspace. Works whatever the workspace's `contentLanguage` is. | A heuristic. It fails only on a post that mixes the two scripts about evenly, and those posts don't exist. |
| B | One workspace and one key per language (`..._KEY_EN`, `..._KEY_FA`) | Explicit | Two workspaces, two site connections, two brand memories to keep in sync. |
| C | Add `language` to `ContentItem` and to the API payload | Correct long term, useful to customers | Schema change during another stream's schema window, plus a migration on prod. |

**Pick A now.** Move to C after the video stream lands. The detection lives in one
function (`detectPostLocale`), so swapping it later touches one place.

### 3. Rendering the markdown body

| | Option | For | Against |
|---|---|---|---|
| **A** | Small in-house markdown → React renderer: headings, paragraphs, lists, quotes, code, bold, italic, links | No new dependency or lockfile churn. Never emits raw HTML, so model-written content can't inject script. Gives us the heading tree for FAQ extraction. | Covers only the markdown our generator writes. Tables and images render as plain text. |
| B | `react-markdown` + `remark-gfm` | Full GFM | New dependency tree, lockfile conflict risk with other streams, and we would still need a second parser for the FAQ. |

**Pick A.** Add tables when an article needs one.

### 4. Freshness

- Every Content API fetch is cached by Next's data cache for 10 minutes and tagged
  `blog`. The pages also declare `revalidate = 600`.
- Verified in `next build` (2026-11-11): the whole `[locale]` tree renders per
  request, because `i18n/request.ts` reads the timezone cookie. Only
  `/sitemap.xml` lands in the prerender manifest. So the fetch cache is what keeps
  the blog fast, not page ISR. The upside is that a failed fetch is never cached:
  the next request tries again, and a temporary outage can't pin an empty index.
- New `POST /api/blog/revalidate` takes `Bearer CONTIVO_BLOG_REVALIDATE_SECRET`
  and calls `revalidateTag('blog')`. Farjad sets this URL and secret on the
  contivo.app site connection, so a publish shows up immediately rather than
  within 10 minutes. Verified locally: a post switched to DRAFT disappeared from
  the index right after the ping.
- `generateStaticParams` lists the posts known at build time, and
  `dynamicParams = true` renders later slugs.
- If a fetch fails (no key, API down): the index shows the empty state, a post page
  returns 404, and the server logs one `[blog]` line. The build never fails;
  verified by running `next build` against an unreachable API.

## Behaviour

- `/en/blog`, `/fa/blog`: posts for that locale, newest first. Title, date, excerpt.
  Empty state when there are none.
- `/it/blog` → redirect to `/en/blog`. Italian workspaces write in English (see
  `routing.ts`), so there is no Italian content to show.
- `/{locale}/blog/{slug}`: the article. If the post belongs to the other locale,
  308 to the right one. `/it/blog` is a 307, so an Italian blog can still be added
  later. Unknown slug → 404.
- Known limit: the locale switcher on an article leads to the other locale's URL,
  which 308s back to the article's own language. That's correct, but it means the
  switcher does nothing on an article until translations are linked.
- Dates come from `publishedAt` and render in the locale's calendar (Jalali and
  Persian digits for `fa`). `dateModified` comes from `updatedAt`.
- Author: `CONTIVO_BLOG_AUTHOR_NAME` when set (a Person), otherwise the legal
  entity from `site-identity.ts` (an Organization). The API carries no author.

## SEO / AIO / GEO

- `generateMetadata` on both routes: title, description (the excerpt), canonical,
  Open Graph `article` with `publishedTime` and `modifiedTime`.
- hreflang: the index exists in en and fa, so it declares en, fa and x-default
  (no `it`; that URL redirects). A post exists in one locale, so it declares only
  its own language. Pointing the twin at a page with different content is what
  Google penalises.
- JSON-LD on a post: `BlogPosting` (headline, dates, author, publisher,
  inLanguage, mainEntityOfPage), `BreadcrumbList` (Home › Blog › Post), and
  `FAQPage` only when the article has a visible FAQ section. A FAQ section is an
  H2 whose text is FAQ / Frequently asked questions / پرسش‌های متداول / سؤالات
  متداول, followed by H3 questions, each with its answer paragraphs. Google
  requires the FAQ to be visible on the page, and it is.
- JSON-LD on the index: `Blog` with its `blogPost` list, plus `BreadcrumbList`.
- Sitemap: blog indexes for en and fa, and every post under its own locale with
  `lastModified = updatedAt`. Revalidates every 10 minutes, the blog fetch's
  interval, and immediately on the revalidate ping.
- RSS 2.0 at `/{locale}/blog/feed.xml`, linked from the index with
  `<link rel="alternate" type="application/rss+xml">`.

## Plumbing (new public page checklist)

1. `routing.ts` pathnames: `/blog`, `/blog/[slug]`.
2. `global-header.tsx` `hideHeaderRoutes`: `/blog`.
3. Metadata alternates as above.
4. `sitemap.ts`.
5. `blog` namespace in `NAMESPACES` and in `messages/{en,fa,it}/blog.json`.
   `it` is needed even though `/it/blog` redirects, because the namespace loader
   reads every namespace for every locale.
6. A footer link under Company in en, fa and it.

## Env vars (contivo-web)

| Name | Required | Value |
|---|---|---|
| `CONTIVO_BLOG_API_KEY` | yes | Site key for the contivo.app site connection in Farjad's workspace (`ctv_live_…`) |
| `CONTIVO_BLOG_API_URL` | no | Defaults to `${NEXT_PUBLIC_APP_URL}/api/v1`, i.e. `https://www.contivo.app/api/v1` |
| `CONTIVO_BLOG_REVALIDATE_SECRET` | yes, for instant updates | Random string. The same value goes in the site connection's revalidate secret |
| `CONTIVO_BLOG_AUTHOR_NAME` | no | e.g. `Farjad P.D` |

## Out of scope

- A language field in the Content API (option 2C).
- Pairing en and fa translations of the same article for hreflang. That needs
  a translation link in the data.
- Cover images. The API doesn't serve `ContentImage` yet.
- Categories, tags, pagination. Pagination becomes necessary past 100 posts, since
  the index fetches one page of up to 100.

## Tests

- `blog-api.test.ts`: fetch success, auth header, 401/500/network error → empty,
  malformed payload rows dropped, locale filtering, single post 404.
- `blog-content.test.ts`: locale detection, markdown block parsing, FAQ extraction.
- `blog-metadata.test.ts`: post metadata (canonical, single-language hreflang,
  article dates), index alternates, JSON-LD shape (FAQPage present only with a FAQ).

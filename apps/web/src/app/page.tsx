import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

import { AutopilotTerminal } from '@/components/marketing/autopilot-terminal';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-ink-950 text-white selection:bg-signal selection:text-signal-ink">
      <SiteNav />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Grid />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 md:grid-cols-[1.05fr_1fr] md:items-center md:pb-28 md:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 border border-ink-600 px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-ink-200">
              <span className="h-1.5 w-1.5 bg-signal" />
              Marketing that runs while you build
            </p>
            <h1 className="mt-6 font-display text-[40px] font-bold leading-[1.02] tracking-tight sm:text-[54px] md:text-[62px]">
              Your website in.
              <br />
              A month of posts out.
              <br />
              <span className="text-signal">Nobody in between.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-200">
              Contivo reads your site, maps your competitors, learns your keywords — then writes,
              reviews and publishes to LinkedIn, X and your own blog on a schedule you set. Every
              draft passes a quality gate before it goes out.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 bg-signal px-5 py-3 text-[14px] font-semibold text-signal-ink transition-colors hover:bg-white"
              >
                Start with your URL <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#how"
                className="inline-flex items-center gap-2 border border-ink-600 px-5 py-3 text-[14px] font-medium text-ink-100 transition-colors hover:border-ink-400 hover:text-white"
              >
                See how it works
              </Link>
            </div>
            <ul className="mt-8 grid gap-2 text-[13px] text-ink-300 sm:grid-cols-2">
              {[
                'No prompts. Your brand memory is the prompt.',
                'Fully hands-off — or approve first, your call.',
                'Rejects unverifiable claims before publishing.',
                'Your own site: one API key, any stack.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <AutopilotTerminal />
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────── */}
      <section id="how" className="border-t border-ink-700/60 bg-ink-900">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <SectionHead
            kicker="How it works"
            title="Intelligence first. Content second. Publishing last."
            body="Most AI writing tools start from a blank prompt, so they produce blank-prompt content. Contivo refuses to write until it knows who you are and who you're up against."
          />
          <ol className="mt-12 grid gap-px bg-ink-700/60 md:grid-cols-4">
            {[
              {
                n: '01',
                t: 'Brand memory',
                d: 'Paste a URL. Contivo scrapes it into tone, audience, value proposition and offers — editable, and used in every draft after.',
              },
              {
                n: '02',
                t: 'Competitive map',
                d: 'Discovers competitors your size, you accept or reject them, then five positioning matrices and a keyword gap are built around the survivors.',
              },
              {
                n: '03',
                t: 'Autopilot',
                d: 'Set posts per week, channels, and a publish window. It ideates, drafts, and schedules on its own — and retries when the queue runs low.',
              },
              {
                n: '04',
                t: 'Quality gate',
                d: 'Every draft is scored for brand fit, factual safety and clarity. Below threshold or unverifiable? Rejected and regenerated, never posted.',
              },
            ].map((s) => (
              <li key={s.n} className="bg-ink-900 p-7">
                <span className="font-mono text-[11px] tracking-widest text-signal">{s.n}</span>
                <h3 className="mt-3 font-display text-[19px] font-semibold">{s.t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-300">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Autopilot ────────────────────────────────────────────────── */}
      <section id="autopilot" className="border-t border-ink-700/60">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <SectionHead
              kicker="Autopilot"
              title="A policy, not a to-do list."
              body="You describe the outcome once. Contivo keeps the coming week topped up to it, spreads posts across your window, and never repeats itself."
            />
            <dl className="mt-8 grid gap-5 sm:grid-cols-2">
              {[
                ['Cadence', '1–14 posts / week, kept full 7 days ahead'],
                ['Channels', 'LinkedIn · X · Instagram · your website'],
                ['Window', 'Days and local hours you choose'],
                ['Steering', 'Goal, themes to lean into, topics to never touch'],
              ].map(([k, v]) => (
                <div key={k} className="border-l-2 border-signal/60 pl-4">
                  <dt className="font-mono text-[11px] uppercase tracking-widest text-ink-400">{k}</dt>
                  <dd className="mt-1 text-[14px] text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <PolicyCard />
        </div>
      </section>

      {/* ── Quality gate ────────────────────────────────────────────── */}
      <section className="border-t border-ink-700/60 bg-paper text-ink-900">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-600">Quality gate</p>
            <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]">
              Hands-off is only safe if something says no.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-600">
              Publishing with nobody watching means the reviewer has to be built in. Two layers stand
              between a draft and your account — and if the reviewer itself is unavailable, the post
              waits. It never ships unreviewed.
            </p>
          </div>
          <div className="mt-12 grid gap-px bg-ink-200 md:grid-cols-2">
            <div className="bg-paper p-8">
              <h3 className="font-display text-[18px] font-semibold">Deterministic checks</h3>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-400">
                free · instant · never wrong
              </p>
              <ul className="mt-5 space-y-2.5 text-[14px] text-ink-700">
                {[
                  'Platform limits (X 280 chars) and word ranges',
                  'Leaked scaffolding, placeholders, “as an AI…”',
                  'Your never-write-about list, in the body not just the title',
                  'Near-duplicates of what you already published',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 shrink-0 bg-ink-900" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-paper p-8">
              <h3 className="font-display text-[18px] font-semibold">AI judge</h3>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-400">
                brand fit · factual safety · clarity
              </p>
              <ul className="mt-5 space-y-2.5 text-[14px] text-ink-700">
                {[
                  'Scores 0–10; factual safety threshold is the strictest',
                  'Vetoes invented statistics, named studies, regulated advice',
                  'Rejected drafts are pulled from the queue and regenerated',
                  'Both providers down? The post holds. Fail-closed.',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 shrink-0 bg-ink-900" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Intelligence ────────────────────────────────────────────── */}
      <section id="intelligence" className="border-t border-ink-700/60">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <SectionHead
            kicker="Intelligence"
            title="The part most tools skip."
            body="This is where the content gets its spine. It is built once per workspace, kept fresh, and fed into every idea and draft."
          />
          <div className="mt-12 grid gap-px bg-ink-700/60 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Brand Memory', 'Tone, audience, value proposition, offers — extracted from your site and editable.'],
              ['Competitor discovery', 'Finds rivals at your scale, verifies they exist, lets you accept or reject each one.'],
              ['Market matrices', 'Five positioning charts scoring every company 1–10 on two axes. You are always on the map.'],
              ['Keyword intelligence', 'Clusters, intent split and the gaps competitors leave open — from live sites and DataForSEO.'],
              ['Products & services', 'Side-by-side of what you sell vs what they sell, pulled from visible pages.'],
              ['Strategic report', 'A designed PDF of all of the above, five times a month, for the board or the client.'],
            ].map(([t, d]) => (
              <div key={t} className="bg-ink-950 p-7">
                <h3 className="font-display text-[17px] font-semibold">{t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-300">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Channels ────────────────────────────────────────────────── */}
      <section id="channels" className="border-t border-ink-700/60 bg-ink-900">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <div className="grid gap-12 md:grid-cols-[1fr_1.1fr] md:items-center">
            <SectionHead
              kicker="Channels"
              title="Social through OAuth. Your website through one key."
              body="Connect LinkedIn, X, Instagram, Facebook or TikTok once. For your own site — any stack, any host — Contivo gives you an API key and your site pulls its posts. Nothing gets pushed into your codebase."
            />
            <div className="border border-ink-600 bg-ink-950 p-5 font-mono text-[12.5px] leading-relaxed text-ink-100">
              <p className="text-ink-400">{'// your site, server-side'}</p>
              <p>
                <span className="text-signal">const</span> res = <span className="text-signal">await</span>{' '}
                fetch(<span className="text-amber-200">&quot;/api/v1/posts&quot;</span>, {'{'}
              </p>
              <p className="pl-4">
                headers: {'{'} Authorization: <span className="text-amber-200">`Bearer ${'{'}KEY{'}'}`</span> {'}'},
              </p>
              <p className="pl-4">next: {'{'} revalidate: 300 {'}'},</p>
              <p>{'}'});</p>
              <p>
                <span className="text-signal">const</span> {'{'} posts {'}'} ={' '}
                <span className="text-signal">await</span> res.json();
              </p>
              <p className="mt-3 text-ink-400">{'// → [{ slug, title, excerpt, content, publishedAt }]'}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="border-t border-ink-700/60">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <div className="border border-ink-600 bg-ink-900 p-8 md:p-14">
            <p className="font-mono text-[11px] uppercase tracking-widest text-signal">Start</p>
            <h2 className="mt-3 max-w-2xl font-display text-[30px] font-bold leading-tight tracking-tight sm:text-[40px]">
              Paste your URL. In an hour you have a brand memory, a competitive map, and a queue
              that fills itself.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 bg-signal px-5 py-3 text-[14px] font-semibold text-signal-ink hover:bg-white"
              >
                Create your workspace <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="px-5 py-3 text-[14px] text-ink-200 hover:text-white">
                See pricing →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-[11px] uppercase tracking-widest text-signal">{kicker}</p>
      <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]">
        {title}
      </h2>
      <p className="mt-4 text-[16px] leading-relaxed text-ink-300">{body}</p>
    </div>
  );
}

function Grid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
    />
  );
}

function PolicyCard() {
  const rows: Array<[string, string]> = [
    ['enabled', 'true'],
    ['postsPerWeek', '3'],
    ['channels', '["linkedin", "blog"]'],
    ['publishDays', 'Mon Tue Wed Thu Fri'],
    ['window', '09:00 – 18:00 America/Toronto'],
    ['goal', '"authority"'],
    ['topicHints', '["AI adoption for SMEs", "founder lessons"]'],
    ['avoidTopics', '["pricing", "politics"]'],
  ];
  return (
    <div className="border border-ink-600 bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-ink-200">autopilot · policy</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-signal">
          <span className="h-1.5 w-1.5 bg-signal animate-pulse" /> ON
        </span>
      </div>
      <dl className="divide-y divide-ink-700/70">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[130px_1fr] gap-4 px-4 py-2.5 font-mono text-[12.5px]">
            <dt className="text-ink-400">{k}</dt>
            <dd className="text-ink-100">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-ink-700 px-4 py-2.5 font-mono text-[11px] text-ink-400">
        next run: tomorrow 09:00 · last: 2 scheduled, 0 skipped
      </div>
    </div>
  );
}

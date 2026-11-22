import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

import { GlobalHeader } from '@/components/layout/global-header';
import { TimezoneProbe } from '@/components/layout/timezone-probe';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

/*
  Every face is self-hosted from src/fonts (see the README there). next/font's
  Google loader fetches and parses Google's CSS at build time, and that parse
  failed `next build` on roughly two runs in three (loader.js:122, "reading
  '1'" of null), which would have made Railway deploys fail at random. The
  files are the same OFL faces; weights and variables are unchanged.
*/
const inter = localFont({
  src: '../../fonts/inter-latin-wght.woff2',
  weight: '100 900',
  variable: '--font-inter',
});
const mono = localFont({
  src: '../../fonts/jetbrains-mono-latin-wght.woff2',
  weight: '100 800',
  variable: '--font-mono',
});

/** The signed-in surface's text and numbers (Chalk & Saffron). */
const plex = localFont({
  src: [
    { path: '../../fonts/ibm-plex-sans-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-latin-500.woff2', weight: '500', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-latin-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex',
});
const plexMono = localFont({
  src: [
    { path: '../../fonts/ibm-plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/ibm-plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
});

/** Display voice: an editorial grotesque with real character, not a UI sans blown up. */
/* Variable in weight and optical size; the browser applies opsz from the
   font size on its own (font-optical-sizing: auto). */
const display = localFont({
  src: '../../fonts/bricolage-grotesque-latin-opsz-wght.woff2',
  weight: '200 800',
  variable: '--font-display',
});

/*
  Persian has no equivalent of Bricolage, and faking one by letter-spacing a
  Latin face breaks Persian letter joining outright. Vazirmatn carries the whole
  Persian surface — body and display — at nine real weights, so nothing on the
  Persian side is ever faux-bold.
*/
const vazir = localFont({
  src: '../../fonts/vazirmatn-wght.woff2',
  weight: '100 900',
  variable: '--font-vazir',
  display: 'swap',
});

/*
  None of the Latin faces has Hebrew glyphs. On /he, globals.css points the
  display, sans and Plex variables at this face, the way Vazirmatn carries /fa.
  Not preloaded: only /he needs it.
*/
const plexHebrew = localFont({
  src: [
    { path: '../../fonts/ibm-plex-sans-hebrew-400.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-hebrew-500.woff2', weight: '500', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-hebrew-600.woff2', weight: '600', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-hebrew-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-hebrew',
  display: 'swap',
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: t('title'),
    description: t('description'),
    /*
      `metadataBase` is what turns the relative alternates below into fully
      qualified URLs. Google requires hreflang targets to carry a scheme and
      host and ignores them otherwise, so without this the two languages are
      published as competing duplicates rather than as translations of each
      other — which defeats the reason the locales live in the URL at all.
    */
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.contivo.app'),
    /*
      Tells Google the two versions are the same page in two languages rather
      than duplicates competing with each other. `x-default` names the version
      a searcher gets when none of their languages match, which is the same
      answer the middleware gives an unrecognised Accept-Language.
    */
    alternates: {
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        'x-default': `/${routing.defaultLocale}`,
      },
    },
  };
}

/*
  Direction contract for the marketing surface. Emitted as a real HTML comment
  rather than a JSX one, because JSX comments are compiled away and a contract
  the build erases is a contract nobody can audit.
*/
const DIRECTION_CONTRACT = `
THESIS: One URL goes in and a marketing system comes out - and the thing worth
paying for is the moment it REFUSES. The site is built on the app's own
structure, the Loop (Know, Watch, Think, Make, Ship, Learn), walked in order;
stage 03, the refusal, owns a full-bleed dark field and can be pressed.
OWN-WORLD: Chalk & Saffron, the same system as the signed-in app. Chalk ground
(#EEEDE6), moss ink (#17201B), forest field (#1E2E25), one saffron (#E3A21A)
that means "you" on a chart and "act" on a button. Bricolage Grotesque display,
IBM Plex Sans and Mono. Emphasis is a saffron marker stroke, never italics.
Every product image is a capture of the real app.
MOTION: every movement demonstrates behaviour - the loop drawing itself, the
read in four steps, the lock refusing, the cadence filling a week, the run log
recording a veto. All of it is motion-safe and stills cleanly.
BILINGUAL: Persian keeps the same world and changes only what language forces:
Vazirmatn, direction mirrored through logical properties, Persian digits, a
week that starts on Saturday. The loop plot stays clockwise in both.
`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = dirFor(locale);

  return (
    <html lang={locale} dir={dir}>
      <body
        className={`${inter.variable} ${display.variable} ${mono.variable} ${vazir.variable} ${plexHebrew.variable} ${plex.variable} ${plexMono.variable} font-sans bg-chalk text-moss antialiased`}
      >
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        <NextIntlClientProvider messages={messages}>
          <TimezoneProbe />
          <GlobalHeader />

          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans, Inter, JetBrains_Mono, Vazirmatn } from 'next/font/google';

import { GlobalHeader } from '@/components/layout/global-header';
import { TimezoneProbe } from '@/components/layout/timezone-probe';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

/** The signed-in surface's text and numbers (Chalk & Saffron). */
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

/** Display voice: an editorial grotesque with real character, not a UI sans blown up. */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['opsz'],
});

/*
  Persian has no equivalent of Bricolage, and faking one by letter-spacing a
  Latin face breaks Persian letter joining outright. Vazirmatn carries the whole
  Persian surface — body and display — at nine real weights, so nothing on the
  Persian side is ever faux-bold.
*/
const vazir = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazir',
  display: 'swap',
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
        en: '/en',
        fa: '/fa',
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
        className={`${inter.variable} ${display.variable} ${mono.variable} ${vazir.variable} ${plex.variable} ${plexMono.variable} font-sans bg-chalk text-moss antialiased`}
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

import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Bodoni_Moda, Bricolage_Grotesque, Inter, JetBrains_Mono, Vazirmatn } from 'next/font/google';

import { GlobalHeader } from '@/components/layout/global-header';
import { TimezoneProbe } from '@/components/layout/timezone-probe';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

/** Display voice: an editorial grotesque with real character, not a UI sans blown up. */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['opsz'],
});

/** The one italic accent word, carried over from the onboarding screens. */
const accent = Bodoni_Moda({
  subsets: ['latin'],
  style: ['italic'],
  weight: ['400', '500'],
  variable: '--font-accent',
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
      Tells Google the two versions are the same page in two languages rather
      than duplicates competing with each other.
    */
    alternates: {
      languages: { en: '/en', fa: '/fa' },
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
paying for is the moment it REFUSES. This page is three acts (intake, refusal,
output), not a hero over a grid of feature cards, and it shows the running
product rather than simulated developer chrome.
OWN-WORLD: Warm printed paper (#EFECE5) and carbon ink (#121212), with one brick
red (#C04C36) that owns a whole viewport as a screen-printed ink field rather
than decorating as an accent. Bricolage Grotesque at poster scale, one Bodoni
italic accent word, square corners, hairline rules, no cards, no mono labels,
no eyebrows. Every product image is a capture of the real app.
BILINGUAL: the Persian surface keeps the same world - same paper, same carbon,
same brick, same square corners - and changes only what language forces:
Vazirmatn in place of Bricolage/Bodoni, direction mirrored through logical
properties, Persian digits in prose. It is the same poster set in Persian, not
a second theme.
STORY: A founder with no marketing team sees their own site read in seconds,
understands that Contivo will not write until it has intelligence, and believes
unattended publishing is safe because something is built to say no.
FIRST VIEWPORT: Cream, full bleed. A display-scale sentence, then the product's
only input set at 2.5rem with a rule that turns red on focus, then the real cost
and token counters from a live workspace. Primary action is the field's submit.
FORM: Three-act intake/refusal/output, first of my ordered list, dealt as the
lead (seed 8e859003, dealt 3 - 4 - 1). Code-led: no comp round was run.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
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
        className={`${inter.variable} ${display.variable} ${accent.variable} ${mono.variable} ${vazir.variable} font-sans bg-paper-warm text-carbon antialiased`}
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

import type { Metadata } from 'next';
import { Bodoni_Moda, Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import { GlobalHeader } from '@/components/layout/global-header';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Contivo — Marketing on autopilot',
  description:
    'Contivo turns your website into brand memory, competitive intelligence and a publishing autopilot: it writes, reviews and posts for you, on a schedule you set.',
};

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${display.variable} ${accent.variable} ${mono.variable} font-sans bg-paper-warm text-carbon antialiased`}
      >
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        <GlobalHeader />

        {children}
      </body>
    </html>
  );
}

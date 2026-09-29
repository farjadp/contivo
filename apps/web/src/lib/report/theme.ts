/**
 * theme.ts — the report's stylesheet, in Chalk & Saffron.
 *
 * Two decisions worth stating:
 *
 * 1. No Tailwind CDN. The old pipeline injected `cdn.tailwindcss.com` at PDF
 *    time, which meant report generation needed the public internet to look
 *    right, and the `.html` copy saved next to the PDF opened completely
 *    unstyled because nothing injected the script when it was served. The CSS
 *    below is self-contained, so the HTML file is the report too.
 *
 * 2. The colours are the product's, not a second system invented for print.
 *    Saffron means "you" on a chart and nowhere else; rival blue always means a
 *    competitor. That rule is what lets a reader decode a matrix without
 *    consulting a legend, and it is already how the app draws the same data.
 */

import { isRtlContentLanguage, type ContentLanguage } from '@/lib/content-language';

export const REPORT_COLORS = {
  chalk: '#EEEDE6',
  chalkRaised: '#F8F7F2',
  chalkSunk: '#E2E1D8',
  moss: '#17201B',
  mossMuted: '#4A544D',
  forest: '#1E2E25',
  forestMuted: '#B9C2B6',
  saffron: '#E3A21A',
  saffronSoft: '#F4DFA8',
  saffronInk: '#6B5410',
  rival: '#3D5F8A',
  rule: '#D5D4CA',
  ruleStrong: '#A9A89C',
} as const;

const LATIN_FONTS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`;
const PERSIAN_FONTS = `@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');`;

/**
 * Persian needs more than a direction flip: the script clips below 1.8 leading,
 * letter-spacing severs the joins that make it readable, and Latin runs inside
 * a Persian sentence (a domain, a metric name) reorder around their own
 * punctuation unless they are isolated.
 */
const RTL_RULES = `
  html { direction: rtl; }
  body { font-family: 'Vazirmatn', Tahoma, sans-serif; line-height: 1.85; }
  * { letter-spacing: 0 !important; }
  .ltr, code, .domain { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  ul, ol { padding-right: 1.1rem; padding-left: 0; }
  th, td { text-align: right; }
`;

export function reportStylesheet(language: ContentLanguage): string {
  const rtl = isRtlContentLanguage(language);
  const c = REPORT_COLORS;

  return `
${rtl ? PERSIAN_FONTS : LATIN_FONTS}

* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
html, body { margin: 0; padding: 0; }

body {
  background: ${c.chalk};
  color: ${c.moss};
  font-family: ${rtl ? `'Vazirmatn', Tahoma, sans-serif` : `'IBM Plex Sans', system-ui, sans-serif`};
  font-size: 10.5pt;
  line-height: 1.6;
}

/* ── Rhythm ─────────────────────────────────────────────────────────────── */
h1, h2, h3 { margin: 0; font-weight: 600; page-break-after: avoid; break-after: avoid; }
p { margin: 0 0 0.7em; }
section { margin-bottom: 26px; }
.page-break { page-break-after: always; break-after: page; }

/* A section title carries a saffron rule instead of a coloured heading: the
   accent marks structure without shouting a colour on every line. */
.section-title {
  font-size: 15pt;
  letter-spacing: -0.01em;
  padding-bottom: 6px;
  margin-bottom: 14px;
  border-bottom: 2px solid ${c.saffron};
}
.section-number {
  font-family: ${rtl ? `'Vazirmatn', sans-serif` : `'IBM Plex Mono', monospace`};
  font-size: 9pt;
  color: ${c.mossMuted};
  margin-inline-end: 8px;
}
.lede { color: ${c.mossMuted}; font-size: 10pt; margin-bottom: 12px; }

/* ── Cover ──────────────────────────────────────────────────────────────── */
.cover {
  background: ${c.forest};
  color: #FFFFFF;
  /* A4 is 297mm; the PDF shell takes 16mm off the top and 20mm off the bottom
     for the running footer, leaving 261mm of printable height. 254mm fills the
     page without risking the 1mm overflow that would push a blank sheet in
     front of the page break. */
  min-height: 254mm;
  padding: 24mm 20mm;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.wordmark { display: flex; align-items: center; gap: 9px; font-size: 13pt; font-weight: 600; }
.wordmark .dot { width: 11px; height: 11px; border-radius: 999px; background: ${c.saffron}; }
.cover-kicker {
  font-size: 9.5pt;
  color: ${c.forestMuted};
  text-transform: ${rtl ? 'none' : 'uppercase'};
  letter-spacing: ${rtl ? '0' : '0.14em'};
  margin-bottom: 14px;
}
.cover-title { font-size: 30pt; line-height: 1.15; font-weight: 600; margin-bottom: 10px; }
.cover-site { color: ${c.saffron}; font-size: 11pt; }
.cover-meta { border-top: 1px solid ${c.forestMuted}44; padding-top: 14px; font-size: 9.5pt; color: ${c.forestMuted}; }
.cover-meta dl { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 22px; margin: 0; }
.cover-meta dt { color: ${c.forestMuted}; margin-bottom: 2px; }
.cover-meta dd { color: #FFFFFF; margin: 0; font-weight: 500; }

/* ── Figures ────────────────────────────────────────────────────────────── */
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
.stat { background: ${c.chalkRaised}; border: 1px solid ${c.rule}; border-radius: 8px; padding: 13px 15px; }
.stat-value { font-size: 21pt; font-weight: 600; line-height: 1; margin-bottom: 5px; }
.stat-label { font-size: 8.5pt; color: ${c.mossMuted}; }

table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 8px; }
th {
  text-align: ${rtl ? 'right' : 'left'};
  background: ${c.chalkSunk};
  color: ${c.moss};
  font-weight: 600;
  padding: 7px 9px;
  border-bottom: 1px solid ${c.ruleStrong};
}
td { padding: 7px 9px; border-bottom: 1px solid ${c.rule}; vertical-align: top; }
tr.is-you td { background: ${c.saffronSoft}; font-weight: 600; }
.domain { font-family: ${rtl ? `'Vazirmatn', sans-serif` : `'IBM Plex Mono', monospace`}; font-size: 8.5pt; color: ${c.mossMuted}; }

.card { background: ${c.chalkRaised}; border: 1px solid ${c.rule}; border-radius: 8px; padding: 13px 15px; margin-bottom: 10px; }
.card h3 { font-size: 11pt; margin-bottom: 5px; }
.card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

.tag {
  display: inline-block;
  border: 1px solid ${c.rule};
  background: ${c.chalkRaised};
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 8pt;
  margin: 0 3px 4px 0;
}
.tag-you { background: ${c.saffronSoft}; border-color: ${c.saffron}; }

.figure { background: ${c.chalkRaised}; border: 1px solid ${c.rule}; border-radius: 8px; padding: 14px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
.figure-caption { font-size: 8.5pt; color: ${c.mossMuted}; margin-top: 8px; }
.legend { display: flex; gap: 16px; font-size: 8.5pt; color: ${c.mossMuted}; margin-top: 9px; }
.legend span { display: flex; align-items: center; gap: 6px; }
.swatch { width: 9px; height: 9px; border-radius: 999px; display: inline-block; }

/* ── Provenance ─────────────────────────────────────────────────────────── */
/* Estimated figures are labelled where they are read, not in a note at the
   back that nobody reaches. */
.note {
  border-inline-start: 3px solid ${c.saffron};
  background: ${c.chalkRaised};
  padding: 10px 13px;
  font-size: 9pt;
  color: ${c.mossMuted};
  margin-bottom: 12px;
}
.footer {
  border-top: 1px solid ${c.rule};
  padding-top: 10px;
  margin-top: 26px;
  font-size: 8.5pt;
  color: ${c.mossMuted};
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
${rtl ? RTL_RULES : ''}
`;
}

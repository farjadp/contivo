/**
 * html-to-pdf.ts
 *
 * Converts an HTML string to a PDF file using Puppeteer (headless Chromium).
 * Puppeteer is the most reliable way to reproduce CSS/Tailwind exactly as
 * designed — it renders through a real browser engine, so gradients, shadows,
 * and custom fonts all survive the conversion intact.
 */

import puppeteer from 'puppeteer';

import { isRtlContentLanguage, type ContentLanguage } from '@/lib/content-language';

/**
 * Everything a Persian PDF needs that an English one does not.
 *
 * A report rendered without this does not fail — it renders, and every Persian
 * glyph comes out as a Chromium fallback: disconnected letters, or tofu boxes.
 * The font is loaded from Google Fonts rather than bundled because this runs
 * through real Chromium, which fetches it exactly as a browser would; if the
 * render host has no network, the `Tahoma` fallback is the one Persian-safe
 * face that Windows and most Linux images already carry.
 */
const RTL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap');
  html { direction: rtl; }
  body {
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    direction: rtl;
    text-align: right;
    /* Persian reads smaller than Latin at the same size, and clips below 1.6
       leading because the descenders and dots need the room. */
    line-height: 1.8;
  }
  /* Tracking breaks the letter joining that makes the script readable, and the
     report templates are Tailwind, which sets it freely. */
  * { letter-spacing: 0 !important; }
  /* Latin runs — URLs, metric names, brand names — reorder around their own
     punctuation unless isolated. */
  code, kbd, samp, .ltr { direction: ltr; unicode-bidi: isolate; }
  /* Tables mirror on their own under rtl; these do not. */
  ul, ol { padding-right: 1.5em; padding-left: 0; }
`;

/**
 * Injects the Tailwind CDN script into the HTML so classes resolve at render time.
 * We deliberately do NOT ask the AI to include this tag to keep its output clean;
 * we add it here where we control the surrounding shell.
 */
function wrapWithShell(html: string, language: ContentLanguage): string {
  const rtl = isRtlContentLanguage(language);
  const lang = rtl ? 'fa' : 'en';
  const dir = rtl ? 'rtl' : 'ltr';
  const rtlStyle = rtl ? RTL_STYLE : '';
  // If the AI already returned a full document, inject Tailwind into <head>.
  // Otherwise, wrap the fragment in a minimal shell.
  const hasHead = /<head[\s>]/i.test(html);

  if (hasHead) {
    return html.replace(
      /<head([^>]*)>/i,
      `<head$1>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Ensure color utilities print accurately in Chrome/Puppeteer */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    /* Each section marked .page-break will start on a fresh PDF page */
    .page-break { page-break-after: always; break-after: page; }
    /* Prevent orphaned headings at the bottom of a page */
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
${rtlStyle}
  </style>`,
    ).replace(/<html([^>]*)>/i, `<html$1 lang="${lang}" dir="${dir}">`);
  }

  // Fragment fallback — wrap in a minimal document
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .page-break { page-break-after: always; break-after: page; }
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
${rtlStyle}
  </style>
</head>
<body class="bg-[#fafaf9] text-slate-900 font-sans">
  ${html}
</body>
</html>`;
}

/**
 * Renders `html` in a headless Chrome instance and writes a PDF to `outputPath`.
 *
 * @param html        Raw HTML string (from generateReportHTML)
 * @param outputPath  Absolute file path where the PDF should be written
 */
export async function convertHtmlToPdf(
  html: string,
  outputPath: string,
  /** The report's language. Decides direction and the embedded font stack. */
  language: ContentLanguage = 'EN',
): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Needed on some Linux hosts where /dev/shm is small
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();

    // High-DPI viewport so text and borders are crisp in the PDF
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });

    const wrappedHtml = wrapWithShell(html, language);

    // setContent + networkidle0 ensures the Tailwind CDN script has fully run
    // before Puppeteer takes the PDF snapshot
    await page.setContent(wrappedHtml, { waitUntil: 'networkidle0', timeout: 30_000 });

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true, // Required to render colored backgrounds
      margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
    });
  } finally {
    // Always close the browser even if an error occurs to avoid zombie processes
    await browser.close();
  }
}

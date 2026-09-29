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
 * Adds only what a print engine needs that the document itself cannot express:
 * exact colour reproduction and page-break behaviour.
 *
 * It used to inject `cdn.tailwindcss.com` here, because the AI-authored HTML
 * was a soup of Tailwind classes with no stylesheet. That made every report
 * depend on a third-party CDN at render time and left the `.html` copy saved
 * beside the PDF completely unstyled. The template now ships its own CSS, so
 * this shell stays out of the document's way.
 */
function wrapWithShell(html: string, language: ContentLanguage): string {
  const rtl = isRtlContentLanguage(language);
  const lang = rtl ? 'fa' : 'en';
  const dir = rtl ? 'rtl' : 'ltr';
  const rtlStyle = rtl ? RTL_STYLE : '';

  const printStyle = `
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .page-break { page-break-after: always; break-after: page; }
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
    /* A figure or a card is a unit and should not be split. A long table is
       not: forcing a ten-row table onto one page pushed it whole onto the next
       sheet and left half a page blank behind it. Let it break, and repeat the
       header so the rows after the break still have their column names. */
    .figure, .card { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
${rtlStyle}
  </style>`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<\/head>/i, `${printStyle}\n</head>`);
  }

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="UTF-8">${printStyle}</head>
<body>${html}</body>
</html>`;
}

/** The footer template is raw HTML handed to Chromium, so its values are escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders `html` in a headless Chrome instance and writes a PDF to `outputPath`.
 *
 * @param html        Raw HTML string (from generateReportHTML)
 * @param outputPath  Absolute file path where the PDF should be written
 */
export interface PdfFooter {
  /** Printed bottom-left on every page, so a loose page still names its source. */
  brand: string;
  /** The report's human reference, bottom-centre. */
  reference: string;
}

export async function convertHtmlToPdf(
  html: string,
  outputPath: string,
  /** The report's language. Decides direction and the embedded font stack. */
  language: ContentLanguage = 'EN',
  /** Omit for no running footer. */
  footer?: PdfFooter,
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

    /*
      A report gets forwarded, printed and pulled apart. Chromium's own running
      footer is the only way to put the source on every page including ones the
      document never knew it would break onto, so identity lives here rather
      than in a div at the end of the body.

      Chromium renders these templates in a separate document with no access to
      the page's styles or fonts, and it defaults them to 8px unstyled — hence
      the inline font stack and explicit size.
    */
    const footerTemplate = footer
      ? `<div style="width:100%;margin:0 12mm;font-family:'Vazirmatn',system-ui,sans-serif;font-size:7.5pt;color:#4A544D;display:flex;justify-content:space-between;">
           <span>${escapeHtml(footer.brand)}</span>
           <span>${escapeHtml(footer.reference)}</span>
           <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
         </div>`
      : '<span></span>';

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true, // Required to render colored backgrounds
      displayHeaderFooter: Boolean(footer),
      headerTemplate: '<span></span>',
      footerTemplate,
      // The bottom margin has to leave room for the running footer, or
      // Chromium prints it over the last line of body text.
      margin: { top: '16mm', right: '14mm', bottom: footer ? '20mm' : '18mm', left: '14mm' },
    });
  } finally {
    // Always close the browser even if an error occurs to avoid zombie processes
    await browser.close();
  }
}

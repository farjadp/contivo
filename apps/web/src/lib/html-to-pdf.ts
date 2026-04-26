/**
 * html-to-pdf.ts
 *
 * Converts an HTML string to a PDF file using Puppeteer (headless Chromium).
 * Puppeteer is the most reliable way to reproduce CSS/Tailwind exactly as
 * designed — it renders through a real browser engine, so gradients, shadows,
 * and custom fonts all survive the conversion intact.
 */

import puppeteer from 'puppeteer';

/**
 * Injects the Tailwind CDN script into the HTML so classes resolve at render time.
 * We deliberately do NOT ask the AI to include this tag to keep its output clean;
 * we add it here where we control the surrounding shell.
 */
function wrapWithShell(html: string): string {
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
  </style>`,
    );
  }

  // Fragment fallback — wrap in a minimal document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .page-break { page-break-after: always; break-after: page; }
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
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
export async function convertHtmlToPdf(html: string, outputPath: string): Promise<void> {
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

    const wrappedHtml = wrapWithShell(html);

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

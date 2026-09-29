import { describe, expect, it } from 'vitest';

import { extractHtmlLangAttr, extractSignalsFromHtml, extractTitle } from './judge';

/**
 * These are timing tests, not correctness tests — `judge.test.ts` already
 * covers what these functions extract. This file exists to reproduce the
 * measurement that justified bounding every quantifier in judge.ts's HTML
 * regexes (see that file's comment above `TITLE_RE`), and to lock in the
 * fix: each pathological input below is built to be exactly the shape that
 * made the *unbounded* originals blow up (a tag opener repeated with no
 * closing `>`, or an opening block tag repeated with no closing tag), sized
 * at 256KB — the real cap `readCappedText` enforces in production — and
 * each assertion requires the call to finish well inside a budget that
 * would be unacceptable to block the Node event loop for, even though
 * `enrichCandidates` runs several of these concurrently.
 *
 * A budget of 1 second per call is deliberately generous relative to what
 * was measured while writing this fix (real numbers, this machine):
 *   - unbounded META_DESCRIPTION-shaped pattern: 898ms at 16KB alone,
 *     still running unfinished at 256KB after 400 seconds.
 *   - unbounded block-tag pattern: ~1.9s at 256KB with a 20000-char content
 *     span, ~204ms at 256KB with the 2000-char span this fix ships.
 * If this test ever creeps back up near the 1s budget, that is a real
 * regression toward the bug this file exists to prevent, not a flake.
 */
const TIME_BUDGET_MS = 1000;
const CAP_BYTES = 256 * 1024;

function repeatToSize(chunk: string, totalBytes: number): string {
  return chunk.repeat(Math.ceil(totalBytes / chunk.length)).slice(0, totalBytes);
}

describe('ReDoS resistance (bounded quantifiers)', () => {
  it('extractSignalsFromHtml completes within budget on a page of nothing but an unclosed <meta name="description" ', () => {
    const hostile = repeatToSize('<meta name="description" ', CAP_BYTES);

    const start = Date.now();
    const result = extractSignalsFromHtml(hostile);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
    expect(result).toEqual([]); // no closing tag anywhere — nothing to extract, not a crash
  });

  it('extractSignalsFromHtml completes within budget on a page of nothing but unclosed <p> tags', () => {
    const hostile = repeatToSize('<p>', CAP_BYTES);

    const start = Date.now();
    const result = extractSignalsFromHtml(hostile);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
    expect(result).toEqual([]);
  });

  it('extractSignalsFromHtml completes within budget on a page of nothing but unclosed <title> openers', () => {
    const hostile = repeatToSize('<title ', CAP_BYTES);

    const start = Date.now();
    extractSignalsFromHtml(hostile);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('extractTitle completes within budget on the same hostile input', () => {
    const hostile = repeatToSize('<title ', CAP_BYTES);

    const start = Date.now();
    extractTitle(hostile);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('extractHtmlLangAttr completes within budget on an unclosed <html lang= opener', () => {
    const hostile = repeatToSize('<html lang="', CAP_BYTES);

    const start = Date.now();
    extractHtmlLangAttr(hostile);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });

  it('still extracts real signals correctly from a normal page (the bound does not break legitimate content)', () => {
    const html = `
      <html lang="en-US">
        <head>
          <title>Acme Rockets</title>
          <meta name="description" content="We build reusable rockets for small satellites.">
        </head>
        <body>
          <h1>Acme Rockets — reusable launch for small payloads</h1>
          <p>Acme Rockets designs and flies small reusable launch vehicles for the smallsat market.</p>
        </body>
      </html>
    `;

    expect(extractTitle(html)).toBe('Acme Rockets');
    expect(extractHtmlLangAttr(html)).toBe('en-us');
    const signals = extractSignalsFromHtml(html);
    expect(signals.some((line) => line.includes('reusable rockets for small satellites'))).toBe(true);
    expect(signals.some((line) => line.includes('reusable launch for small payloads'))).toBe(true);
  });
});

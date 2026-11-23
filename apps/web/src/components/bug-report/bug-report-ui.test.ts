/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en/bugreport.json';
import es from '../../../messages/es/bugreport.json';
import fa from '../../../messages/fa/bugreport.json';
import he from '../../../messages/he/bugreport.json';
import it_ from '../../../messages/it/bugreport.json';
import type { ClientContext } from '@/lib/bug-report/types';
import { readRefFromCookie, readViewedIds, restoreFocus, stripLocale } from './page-signals';
import { sendReport } from './report-flow';

vi.mock('@/app/actions/bug-report', () => ({ submitBugReport: vi.fn() }));

const { ReportSheetBody } = await import('./ReportSheet');
const { RefToast } = await import('./RefToast');

const client: ClientContext = {
  route: '/dashboard',
  locale: 'en',
  viewport: { w: 375, h: 700 },
  breadcrumbs: [],
  consoleErrors: [],
  viewedIds: {},
};
const noop = () => {};
const catalogues = { en, fa, he, it: it_, es } as const;

function withIntl(locale: keyof typeof catalogues, node: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale], timeZone: 'UTC', children: node }),
  );
}

function sheet(locale: keyof typeof catalogues, over: Partial<Parameters<typeof ReportSheetBody>[0]> = {}) {
  return withIntl(
    locale,
    createElement(ReportSheetBody, {
      phase: 'form',
      message: '',
      attachedRef: null,
      sentRef: null,
      error: null,
      titleId: 't1',
      fieldId: 'f1',
      onMessageChange: noop,
      onSend: noop,
      onRetry: noop,
      onClose: noop,
      ...over,
    }),
  );
}

describe('ReportSheetBody', () => {
  it('renders a labelled textarea capped at 1000, the note and Send', () => {
    const html = sheet('en');
    expect(html).toContain('for="f1"');
    expect(html).toContain('id="f1"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('Never your drafts or passwords.');
    expect(html).toContain('>Send<');
    expect(html).toContain('id="t1"');
  });

  it('attaches a ref as LTR text', () => {
    expect(sheet('en', { attachedRef: 'CTV-7F3K' })).toContain('dir="ltr"');
    expect(sheet('en', { attachedRef: 'CTV-7F3K' })).toContain('CTV-7F3K');
  });

  it('shows the reference and a copy control once sent', () => {
    const html = sheet('en', { phase: 'sent', sentRef: 'CTV-AB23' });
    expect(html).toContain('We got it.');
    expect(html).toContain('CTV-AB23');
    expect(html).toContain('Copy: CTV-AB23');
    expect(html).not.toContain('<textarea');
  });

  it('shows the error text and Retry', () => {
    const html = sheet('en', { phase: 'error', error: 'Too many reports. Try later.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Too many reports. Try later.');
    expect(html).toContain('Try again');
  });

  it('disables the field while sending', () => {
    expect(sheet('en', { phase: 'sending' })).toContain('disabled');
  });

  it.each(['fa', 'he', 'it', 'es'] as const)('renders in %s with its own copy and no English fallback key paths', (locale) => {
    const html = sheet(locale, { attachedRef: 'CTV-7F3K' });
    expect(html).toContain(catalogues[locale].bugReport.sheet.send);
    expect(html).not.toContain('bugReport.');
    expect(html).not.toContain('Send<');
  });

  it('formats the counter with Persian digits in fa', () => {
    expect(sheet('fa')).toContain('۰ از ۱٬۰۰۰');
  });
});

describe('RefToast', () => {
  it('renders the message, ref and actions; nothing without a ref', () => {
    const html = withIntl('en', createElement(RefToast, { refCode: 'CTV-7F3K', onReport: noop, onDismiss: noop }));
    expect(html).toContain('Something failed on our side.');
    expect(html).toContain('CTV-7F3K');
    expect(html).toContain('Report this');
    expect(html).toContain('role="status"');
    expect(withIntl('en', createElement(RefToast, { refCode: null, onReport: noop, onDismiss: noop }))).toBe('');
  });
});

describe('sendReport', () => {
  const base = { message: '  hi  ', ref: 'CTV-7F3K', client, fallbackError: 'fallback' };

  it('passes trimmed message, ref and context; returns the ref', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, ref: 'CTV-9ZZZ' });
    expect(await sendReport(submit, base)).toEqual({ phase: 'sent', ref: 'CTV-9ZZZ' });
    expect(submit).toHaveBeenCalledWith({ message: 'hi', ref: 'CTV-7F3K', client });
  });

  it('omits an empty message and null ref', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, ref: 'CTV-9ZZZ' });
    await sendReport(submit, { ...base, message: '   ', ref: null });
    expect(submit).toHaveBeenCalledWith({ client });
  });

  it('returns the server text on failure, the fallback when empty or thrown', async () => {
    expect(await sendReport(async () => ({ ok: false, error: 'Slow down' }), base)).toEqual({ phase: 'error', error: 'Slow down' });
    expect(await sendReport(async () => ({ ok: false, error: '' }), base)).toEqual({ phase: 'error', error: 'fallback' });
    expect(await sendReport(async () => { throw new Error('net'); }, base)).toEqual({ phase: 'error', error: 'fallback' });
  });
});

describe('page signals', () => {
  it('reads only a valid ref from the cookie', () => {
    expect(readRefFromCookie('a=1; ctv-last-ref=CTV-7F3K; b=2', 'ctv-last-ref')).toBe('CTV-7F3K');
    expect(readRefFromCookie('ctv-last-ref=CTV-0OIL', 'ctv-last-ref')).toBeNull();
    expect(readRefFromCookie('ctv-last-ref=%E0%A4%A', 'ctv-last-ref')).toBeNull();
    expect(readRefFromCookie('', 'ctv-last-ref')).toBeNull();
  });

  it('collects the workspace id and data-* ids', () => {
    const root = { querySelector: (sel: string) => (sel === '[data-matrix-run-id]' ? { getAttribute: () => 'mr1' } : null) } as never;
    expect(readViewedIds(root, 'ws1')).toEqual({ workspaceId: 'ws1', matrixRunId: 'mr1' });
    expect(readViewedIds(null, null)).toEqual({});
  });
});

describe('source rules', () => {
  const webRoot = path.resolve(__dirname, '../..');
  const dirs = [path.join(webRoot, 'components/bug-report'), path.join(webRoot, 'app/[locale]/(admin)/admin/reports')];
  const adminShared = path.join(webRoot, 'app/[locale]/(admin)/admin/_components');

  function files(dir: string, filter: (n: string) => boolean): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(path.join(dir, e.name), filter) : filter(e.name) ? [path.join(dir, e.name)] : [],
    );
  }
  const ui = [
    ...dirs.flatMap((d) => files(d, (n) => /\.tsx$/.test(n))),
    ...files(adminShared, (n) => /^Reports.*\.tsx$/.test(n)),
  ];

  it('finds the files it is meant to guard', () => {
    expect(ui.length).toBeGreaterThanOrEqual(10);
  });

  it('uses no physical-direction Tailwind classes', () => {
    const physical = /\b(ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)-/;
    for (const file of ui) {
      const bad = readFileSync(file, 'utf8').split('\n').filter((l) => physical.test(l));
      expect(bad, path.basename(file)).toEqual([]);
    }
  });

  it('never renders HTML from stored text', () => {
    for (const file of ui) expect(readFileSync(file, 'utf8'), path.basename(file)).not.toContain('dangerouslySetInnerHTML');
  });

  it('has the same bugReport keys in every locale', () => {
    const flat = (v: unknown, p = ''): string[] =>
      typeof v === 'object' && v ? Object.entries(v).flatMap(([k, x]) => flat(x, p ? `${p}.${k}` : k)) : [p];
    const base = flat(en).sort();
    for (const [name, cat] of Object.entries(catalogues)) expect(flat(cat).sort(), name).toEqual(base);
  });
});

describe('stripLocale', () => {
  it('removes only a leading locale segment', () => {
    expect(stripLocale('/fa/growth/abc', 'fa')).toBe('/growth/abc');
    expect(stripLocale('/en', 'en')).toBe('/');
    expect(stripLocale('/growth/abc', 'en')).toBe('/growth/abc');
    expect(stripLocale('/english/x', 'en')).toBe('/english/x');
  });
});

describe('ReportSheet dialog semantics', () => {
  it('declares role=dialog, aria-modal and a label pointing at the visible title', async () => {
    const { ReportSheet: Sheet } = await import('./ReportSheet');
    const html = withIntl(
      'en',
      createElement(Sheet, { prefillRef: null, fallbackRef: null, getContext: () => client, onClose: noop }),
    );
    expect(html).toMatch(/<dialog[^>]*role="dialog"/);
    expect(html).toMatch(/<dialog[^>]*aria-modal="true"/);
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}"`);
  });
});

describe('restoreFocus', () => {
  it('returns focus to the opener when it is still in the page', () => {
    const focus = vi.fn();
    restoreFocus({ isConnected: true, focus });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a missing or detached opener', () => {
    const focus = vi.fn();
    restoreFocus(null);
    restoreFocus({ isConnected: false, focus });
    expect(focus).not.toHaveBeenCalled();
  });
});

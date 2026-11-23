'use client';

import { useState } from 'react';

import { submitBugReport } from '@/app/actions/bug-report';
import { refFromDigest, generateRef } from '@/lib/bug-report/ref';

/**
 * Last-resort boundary: a crash in the root layout renders this instead of a
 * blank page.
 *
 * It sits above every provider and outside [locale], so it has no Tailwind
 * context, no next-intl and no report sheet: inline styles and English only.
 * The browser does not report to Sentry (the SDK costs 82kB of First Load JS
 * on every page); the server side does. What ties this screen to that report
 * is the Ref line: `refFromDigest(error.digest)` is the same code the server
 * computes from the same digest, so it finds the matching log line. With no
 * digest (a purely client error) a fresh ref is generated once.
 *
 * "Report this" sends a minimal report: the ref, route and language, with
 * empty breadcrumb and console buffers.
 */

type SendState = 'idle' | 'sending' | 'sent' | 'error';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [fallbackRef] = useState(generateRef);
  const ref = error.digest ? refFromDigest(error.digest) : fallbackRef;
  const [send, setSend] = useState<SendState>('idle');

  async function report() {
    setSend('sending');
    try {
      const result = await submitBugReport({
        ref,
        client: {
          route: window.location.pathname,
          locale: document.documentElement.lang || 'en',
          viewport: { w: window.innerWidth, h: window.innerHeight },
          breadcrumbs: [],
          consoleErrors: [],
          viewedIds: {},
        },
      });
      setSend(result.ok ? 'sent' : 'error');
    } catch {
      setSend('error');
    }
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#EFECE5',
          color: '#121212',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.75rem', letterSpacing: '-0.02em' }}>
            Something broke on our side.
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, color: '#4A4A46' }}>
            Reloading usually works, and nothing you were doing was lost. If it keeps
            happening, send us a report and we will look at it.
          </p>
          {/*
            A plain anchor, not `<Link>`, and the lint rule is wrong to insist
            otherwise. `global-error` replaces the root layout when the layout
            itself has crashed, so there is no router context left for a client
            link to use — a full document navigation is the only thing that can
            be relied on here. This file also sits outside `[locale]`, so there
            is no locale to build a localised href from; `/` lets the
            middleware negotiate the language again from scratch, which is the
            right outcome for someone whose session just fell over.
          */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: 'inline-block',
                background: '#121212',
                color: '#EFECE5',
                padding: '0.75rem 1.5rem',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Back to the start
            </a>
            <button
              type="button"
              onClick={report}
              disabled={send === 'sending' || send === 'sent'}
              style={{
                background: 'transparent',
                color: '#121212',
                border: '1px solid #121212',
                padding: '0.75rem 1.5rem',
                font: 'inherit',
                fontWeight: 600,
                cursor: send === 'sending' || send === 'sent' ? 'default' : 'pointer',
              }}
            >
              {send === 'sending' ? 'Sending...' : send === 'sent' ? 'Report sent' : 'Report this'}
            </button>
          </div>
          {send === 'error' ? (
            <p role="alert" style={{ margin: '1rem 0 0', color: '#8A1C1C' }}>
              We could not send that. Quote the reference below if you write to us.
            </p>
          ) : null}
          <p style={{ margin: '1.5rem 0 0', fontSize: '0.8rem', color: '#6B6B66' }}>
            Ref{' '}
            <bdi dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>
              {ref}
            </bdi>
          </p>
        </div>
      </body>
    </html>
  );
}

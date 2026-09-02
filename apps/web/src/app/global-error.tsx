'use client';

/**
 * Last-resort boundary: a crash in the root layout renders this instead of a
 * blank page.
 *
 * It does not report to Sentry, because error reporting here is server-side
 * only — the browser SDK costs 82kB of First Load JS on every page including
 * the landing page, and every failure that has actually hurt this product was
 * a silent server-side one. A client crash at least shows the person
 * something. If browser errors ever need reporting, it is one file:
 * src/instrumentation-client.ts calling Sentry.init.
 */

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // The digest is what ties this screen to the server-side report.
  const digest = error.digest;

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
            The error has been reported. Reloading usually works — nothing you were
            doing was lost.
          </p>
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
          {digest ? (
            <p style={{ margin: '1.5rem 0 0', fontSize: '0.8rem', color: '#6B6B66' }}>
              Reference: {digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}

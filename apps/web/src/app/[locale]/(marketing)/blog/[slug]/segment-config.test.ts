import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Next reads segment config statically, so this guards the source itself.
// As ISR, a slug not prerendered at build rendered in static mode, the
// cookies() read in i18n/request.ts threw DYNAMIC_SERVER_USAGE, and
// production answered 500 for every new post and every unknown slug.
const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('blog post segment config', () => {
  it('renders per request', () => {
    expect(source).toMatch(/export const dynamic = 'force-dynamic';/);
  });

  it('does not switch back to ISR', () => {
    expect(source).not.toMatch(/export const revalidate\b/);
    expect(source).not.toMatch(/export (async )?function generateStaticParams/);
  });

  it('still answers an unknown slug with notFound()', () => {
    expect(source).toMatch(/if \(!post\) notFound\(\);/);
  });
});

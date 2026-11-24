import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// W3 for the Products & Services tab (CPO c): no token counts and no model
// name on a customer screen. A source check, because the tab needs a whole
// workspace payload to render.
const source = readFileSync(join(__dirname, 'ProductsServicesTab.tsx'), 'utf8');
const TELEMETRY_KEYS = [
  'metricLastRunTokens',
  'metricLifetimeTokens',
  'lastRunUsage',
  'lifetimeUsage',
  'tokenPrompt',
  'tokenCompletion',
  'tokenTotal',
  'tokenRuns',
  'modelLine',
  'noTokenData',
];

describe('ProductsServicesTab shows no AI telemetry', () => {
  it('renders no token or model lines', () => {
    expect(source).not.toMatch(/token_usage\.|TokenCard/);
    for (const key of TELEMETRY_KEYS) expect(source, key).not.toContain(`'${key}'`);
  });

  it('keeps none of their messages in any app locale', () => {
    for (const locale of ['en', 'fa', 'it', 'es', 'he']) {
      const offerings = JSON.parse(readFileSync(join(__dirname, `../../../../../../../messages/${locale}/tabs-b.json`), 'utf8')).tabsB
        .offerings as Record<string, unknown>;
      for (const key of TELEMETRY_KEYS) expect(offerings[key], `${locale}.${key}`).toBeUndefined();
    }
  });
});

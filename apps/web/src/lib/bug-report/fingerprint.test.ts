import { describe, expect, it } from 'vitest';

import { computeFingerprint, routePattern } from './fingerprint';

describe('routePattern', () => {
  it('strips locale, query and collapses ids', () => {
    expect(routePattern('/fa/growth/clxyz0123456789abcdefghij/matrices?tab=1')).toBe('/growth/:id/matrices');
    expect(routePattern('/en/growth/123e4567-e89b-12d3-a456-426614174000')).toBe('/growth/:id');
    expect(routePattern('/he/reports/42')).toBe('/reports/:id');
    expect(routePattern('/')).toBe('/');
    expect(routePattern(null)).toBe('/');
  });
});

describe('computeFingerprint', () => {
  it('ten users, different workspaces and locales, same cause: one fingerprint', () => {
    const prints = new Set(
      Array.from({ length: 10 }, (_, i) =>
        computeFingerprint({
          causeCode: 'PROVIDER_OUT_OF_CREDIT',
          failedAction: 'startMatrixRun',
          route: `/${i % 2 ? 'fa' : 'en'}/growth/c${String(i).padStart(24, 'a')}/matrices`,
        }),
      ),
    );
    expect(prints.size).toBe(1);
  });

  it('differs by cause, action and route', () => {
    const base = { causeCode: 'PROVIDER_OUT_OF_CREDIT' as const, failedAction: 'startMatrixRun', route: '/en/growth/x/matrices' };
    const f = computeFingerprint(base);
    expect(computeFingerprint({ ...base, causeCode: 'PROVIDER_TIMEOUT' })).not.toBe(f);
    expect(computeFingerprint({ ...base, failedAction: 'startDiscovery' })).not.toBe(f);
    expect(computeFingerprint({ ...base, route: '/en/dashboard' })).not.toBe(f);
  });

  it('is a 12-char hex, accepts runType and missing cause', () => {
    expect(computeFingerprint({ runType: 'matrix_run', route: '/en/x' })).toMatch(/^[0-9a-f]{12}$/);
    expect(computeFingerprint({ runType: 'matrix_run', route: '/en/x' })).toBe(
      computeFingerprint({ causeCode: null, failedAction: 'matrix_run', route: '/x' }),
    );
  });
});

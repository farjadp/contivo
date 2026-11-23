import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ captureRequestError: vi.fn(), setTag: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureRequestError: m.captureRequestError,
  getCurrentScope: () => ({ setTag: m.setTag }),
}));
vi.mock('@/lib/sentry-options', () => ({ sentryOptions: {} }));

import { refFromDigest } from '@/lib/bug-report/ref';

import { onRequestError } from './instrumentation';

const request = { path: '/x', method: 'GET', headers: {} } as never;
const context = { routerKind: 'App Router', routePath: '/x', routeType: 'render', renderSource: 'react-server-components' } as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('onRequestError', () => {
  it('tags the ref derived from the digest, logs it, and still reports to Sentry', () => {
    const err = Object.assign(new Error('secret upstream text'), { digest: '2087613456' });
    void onRequestError(err, request, context);
    expect(m.setTag).toHaveBeenCalledWith('ref', refFromDigest('2087613456'));
    expect(console.error).toHaveBeenCalledWith(`[${refFromDigest('2087613456')}] render/action error digest=2087613456`);
    expect(m.captureRequestError).toHaveBeenCalledWith(err, request, context);
  });

  it('passes through errors without a digest', () => {
    const err = new Error('x');
    void onRequestError(err, request, context);
    expect(m.setTag).not.toHaveBeenCalled();
    expect(m.captureRequestError).toHaveBeenCalledWith(err, request, context);
  });

  it('reports even when tagging throws', () => {
    m.setTag.mockImplementation(() => {
      throw new Error('scope gone');
    });
    void onRequestError(Object.assign(new Error('x'), { digest: 'd' }), request, context);
    expect(m.captureRequestError).toHaveBeenCalledTimes(1);
  });
});

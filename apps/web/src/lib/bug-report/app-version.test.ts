import { describe, expect, it } from 'vitest';

import { resolveAppVersion } from './app-version';

describe('resolveAppVersion', () => {
  it('prefers the build-time stamp (first 7 chars)', () => {
    expect(
      resolveAppVersion({
        APP_COMMIT_SHA: 'abcdef1234567890',
        RAILWAY_GIT_COMMIT_SHA: '1111111222',
        RAILWAY_DEPLOYMENT_ID: 'dep-1',
      }),
    ).toBe('abcdef1');
  });

  it('falls back to the Railway git sha', () => {
    expect(resolveAppVersion({ APP_COMMIT_SHA: '', RAILWAY_GIT_COMMIT_SHA: '1111111222', RAILWAY_DEPLOYMENT_ID: 'dep' })).toBe(
      '1111111',
    );
  });

  it('falls back to deploy:<first 8 of the deployment id>', () => {
    expect(resolveAppVersion({ RAILWAY_DEPLOYMENT_ID: '9f8e7d6c-5b4a-3210-aaaa-bbbbccccdddd' })).toBe('deploy:9f8e7d6c');
  });

  it('treats whitespace-only values as missing', () => {
    expect(resolveAppVersion({ APP_COMMIT_SHA: '  ', RAILWAY_GIT_COMMIT_SHA: '\n', RAILWAY_DEPLOYMENT_ID: ' x1 ' })).toBe('deploy:x1');
  });

  it('returns null when nothing is set', () => {
    expect(resolveAppVersion({})).toBeNull();
    expect(resolveAppVersion({ APP_COMMIT_SHA: '', RAILWAY_GIT_COMMIT_SHA: undefined, RAILWAY_DEPLOYMENT_ID: ' ' })).toBeNull();
  });
});

/**
 * publish-errors.ts
 *
 * Two kinds of publish failure, so the executor never has to guess:
 * - TransientPublishError: retry later (network, rate limit, 5xx on a check).
 *   The connection status must not change.
 * - PermanentPublishError: retrying will not help (bad token, unsupported
 *   platform, rejected content). Recorded as FAILED at once.
 *
 * Both carry a PublishFailureCode (@contivo/types); the stored reason is
 * formatFailure(code, message) = "[CODE] message".
 */

import type { PublishFailureCode } from '@contivo/types';

export class TransientPublishError extends Error {
  constructor(
    message: string,
    readonly retryAfterSec?: number,
    readonly code: PublishFailureCode = 'UNREACHABLE',
  ) {
    super(message);
    this.name = 'TransientPublishError';
  }
}

export class PermanentPublishError extends Error {
  constructor(message: string, readonly code: PublishFailureCode = 'PLATFORM_ERROR') {
    super(message);
    this.name = 'PermanentPublishError';
  }
}

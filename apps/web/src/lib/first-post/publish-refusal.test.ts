import { describe, expect, it } from 'vitest';

import { parsePublishRefusal, publishRefusalHref, refusalFromReason } from './publish-refusal';

describe('publish refusal', () => {
  it('maps publishNow reasons to the closed list', () => {
    expect(refusalFromReason('no_connection')).toBe('noConnection');
    expect(refusalFromReason('quality_gate_blocked')).toBe('gateBlocked');
    expect(refusalFromReason('not_found')).toBe('notFound');
    expect(refusalFromReason('something_new')).toBe('notFound');
  });

  it('adds the refusal to the tab href and replaces an earlier one', () => {
    expect(publishRefusalHref('/growth/ws_1?tab=first-post', 'gateBlocked')).toBe(
      '/growth/ws_1?tab=first-post&publish=gateBlocked',
    );
    expect(publishRefusalHref('/growth/ws_1?tab=first-post&publish=notFound', 'noConnection')).toBe(
      '/growth/ws_1?tab=first-post&publish=noConnection',
    );
    expect(publishRefusalHref('/growth/ws_1', 'notFound')).toBe('/growth/ws_1?publish=notFound');
  });

  it('reads only known values', () => {
    expect(parsePublishRefusal('gateBlocked')).toBe('gateBlocked');
    expect(parsePublishRefusal(['noConnection', 'x'])).toBe('noConnection');
    expect(parsePublishRefusal('<script>')).toBeNull();
    expect(parsePublishRefusal(undefined)).toBeNull();
  });
});

describe('withoutPublishRefusal', () => {
  it('drops only the publish param, keeping the rest and the hash', async () => {
    const { withoutPublishRefusal } = await import('./publish-refusal');
    expect(withoutPublishRefusal('/fa/growth/w1?tab=first-post&publish=gateBlocked')).toBe('/fa/growth/w1?tab=first-post');
    expect(withoutPublishRefusal('/growth/w1?publish=noConnection#x')).toBe('/growth/w1#x');
    expect(withoutPublishRefusal('/growth/w1?tab=first-post')).toBe('/growth/w1?tab=first-post');
  });
});

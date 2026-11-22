/**
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { classify, parseArgs } from '../scripts/fix-b6-twitter-channel';

const saved = (savedFormat: string | null, status = 'GENERATED') => ({ status, savedFormat, hasSaveRecord: true });

describe('fix-b6-twitter-channel classify', () => {
  it('moves a LinkedIn format that only contains the letter x', () => {
    assert.deepEqual(classify(saved('LinkedIn text post with one example')), { kind: 'misrouted', target: 'linkedin' });
    assert.deepEqual(classify(saved('Expert explainer')), { kind: 'misrouted', target: 'linkedin' });
  });

  it('moves to the channel the format names as a word', () => {
    assert.deepEqual(classify(saved('Long-form blog article, next steps')), { kind: 'misrouted', target: 'blog' });
    assert.deepEqual(classify(saved('Email newsletter text')), { kind: 'misrouted', target: 'email' });
  });

  it('leaves formats that name X alone', () => {
    for (const f of ['X thread', 'Twitter/X post', 'tweet', 'twitter', 'Thread with an example']) {
      assert.deepEqual(classify(saved(f)), { kind: 'x_intended' });
    }
  });

  it('trusts the platform the user picked at ideation', () => {
    assert.deepEqual(classify({ ...saved('Short post with an example'), chosenPlatform: 'x' }), { kind: 'x_intended' });
    assert.deepEqual(classify({ ...saved('Short post with an example'), chosenPlatform: 'blog' }), { kind: 'misrouted', target: 'blog' });
    assert.deepEqual(classify({ ...saved('X thread'), chosenPlatform: 'linkedin' }), { kind: 'x_intended' });
  });

  it('never touches published items or items with no save record', () => {
    assert.deepEqual(classify(saved('LinkedIn text', 'PUBLISHED')), { kind: 'published' });
    assert.deepEqual(classify(saved('LinkedIn text', 'PUBLISHING')), { kind: 'published' });
    assert.deepEqual(classify({ status: 'DRAFT', savedFormat: null, hasSaveRecord: false }), { kind: 'no_record' });
  });

  it('defaults to dry run', () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs(['--apply']).apply, true);
    assert.throws(() => parseArgs(['--yes']));
  });
});

/**
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { describeDatasource, maskEmail, parseArgs } from '../scripts/set-user-cohort';

describe('set-user-cohort parseArgs', () => {
  it('defaults to dry run and lowercases + dedupes emails', () => {
    const o = parseArgs(['--cohort', 'mentees-2026', '--emails', 'A@x.com, a@x.com ,b@y.org']);
    assert.equal(o.apply, false);
    assert.deepEqual(o.selector, { kind: 'emails', values: ['a@x.com', 'b@y.org'] });
  });

  it('accepts --user-ids and --apply', () => {
    const o = parseArgs(['--cohort', 'c1', '--user-ids', 'u1,u2', '--apply']);
    assert.equal(o.apply, true);
    assert.deepEqual(o.selector, { kind: 'userIds', values: ['u1', 'u2'] });
  });

  it('rejects a missing or invalid cohort', () => {
    assert.throws(() => parseArgs(['--emails', 'a@x.com']), /required/);
    for (const bad of ['Mentees', '-x', '', 'a'.repeat(41), 'a b', 'a.b']) {
      assert.throws(() => parseArgs(['--cohort', bad, '--emails', 'a@x.com']));
    }
    assert.doesNotThrow(() => parseArgs(['--cohort', 'a'.repeat(40), '--emails', 'a@x.com']));
  });

  it('requires exactly one selector', () => {
    assert.throws(() => parseArgs(['--cohort', 'c']), /exactly one/);
    assert.throws(() => parseArgs(['--cohort', 'c', '--emails', 'a@x.com', '--user-ids', 'u']), /exactly one/);
    assert.throws(() => parseArgs(['--cohort', 'c', '--emails', 'nope']), /@/);
    assert.throws(() => parseArgs(['--cohort', 'c', '--emails', ' , ']), /empty/);
    assert.throws(() => parseArgs(['--cohort', 'c', '--bogus']), /Unknown/);
  });
});

describe('set-user-cohort output helpers', () => {
  it('masks emails to first char + domain', () => {
    assert.equal(maskEmail('farjad@gmail.com'), 'f***@gmail.com');
    assert.equal(maskEmail('@x.com'), '***');
  });

  it('describes the datasource without credentials', () => {
    const d = describeDatasource('postgresql://user:s3cret@ep-x.neon.tech/neondb?schema=contivo&sslmode=require');
    assert.equal(d, 'ep-x.neon.tech db=neondb schema=contivo');
    assert.ok(!d.includes('s3cret') && !d.includes('user'));
  });
});

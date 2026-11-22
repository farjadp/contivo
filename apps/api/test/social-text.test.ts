/**
 * Run: pnpm --filter @contivo/api test
 * Same samples as apps/web/src/lib/social-text.test.ts (B15).
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { LinkedInAdapter } from '../src/modules/social/adapters/linkedin.adapter';
import { markdownToPlainText, textForChannel } from '../src/modules/social/adapters/social-text';

const samples: Array<{ name: string; input: string; output: string }> = JSON.parse(
  readFileSync(join(__dirname, '../../web/src/lib/social-text.samples.json'), 'utf8'),
);

describe('social-text (publish time)', () => {
  for (const s of samples) {
    it(s.name, () => assert.equal(markdownToPlainText(s.input), s.output));
  }
  it('leaves blog and telegram markdown alone', () => {
    assert.equal(textForChannel('blog', '**x**'), '**x**');
    assert.equal(textForChannel('telegram', '**x**'), '**x**');
    assert.equal(textForChannel('linkedin', '**x**'), 'x');
  });
});

describe('LinkedIn publish payload (B15)', () => {
  it('sends plain text as shareCommentary', () => {
    const adapter = new LinkedInAdapter() as unknown as {
      buildUgcPost(author: string, payload: { body: string; hashtags?: string[] }): {
        specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: string } } };
      };
    };
    const post = adapter.buildUgcPost('abc', { body: '**Hook.**\n\n- a\n- b', hashtags: ['Tag'] });
    assert.equal(post.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text, 'Hook.\n\n• a\n• b\n\n#Tag');
  });
});

import { describe, expect, it } from 'vitest';

import { activeSetupWarnings, isSetupWarningCode } from './workspace-setup-warnings';

describe('setup warnings (B3: no English sentence on a fa page)', () => {
  it('stores the unreadable site and the empty brand read as codes', () => {
    expect(isSetupWarningCode('siteUnreadable')).toBe(true);
    expect(isSetupWarningCode('brandExtractionEmpty')).toBe(true);
  });

  it('reads the old English sentences as those codes', () => {
    expect(
      activeSetupWarnings(['Could not read the website.', 'Brand extraction returned nothing.'], { competitorCount: 0 }),
    ).toEqual(['siteUnreadable', 'brandExtractionEmpty']);
  });
});

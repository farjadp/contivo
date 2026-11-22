import { describe, expect, it } from 'vitest';

import { initials } from './team';

describe('initials', () => {
  it('takes first and last initials in Latin script', () => {
    expect(initials('Hamidreza Salmanmohajer')).toBe('HS');
    expect(initials('bahareh khamouddoust')).toBe('BK');
  });

  it('keeps Persian initials from joining', () => {
    expect(initials('سعید سوزنگر')).toBe('س‌س');
  });

  it('handles a single word', () => {
    expect(initials('Contivo')).toBe('C');
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { allowedCohort } from './signup-cohort';

afterEach(() => {
  delete process.env.SIGNUP_COHORTS;
});

describe('allowedCohort', () => {
  it('keeps a tag on the allowlist (trimmed, exact match)', () => {
    process.env.SIGNUP_COHORTS = ' mentee-nov26 , other_team ';
    expect(allowedCohort('mentee-nov26')).toBe('mentee-nov26');
    expect(allowedCohort('other_team')).toBe('other_team');
  });

  it('drops a tag that is not listed, malformed, or not a string', () => {
    process.env.SIGNUP_COHORTS = 'mentee-nov26';
    expect(allowedCohort('mentee-nov27')).toBeNull();
    expect(allowedCohort('MENTEE-NOV26')).toBeNull();
    expect(allowedCohort('mentee nov26')).toBeNull();
    expect(allowedCohort(null)).toBeNull();
    expect(allowedCohort(undefined)).toBeNull();
    expect(allowedCohort(42)).toBeNull();
  });

  it('drops everything when SIGNUP_COHORTS is unset', () => {
    expect(allowedCohort('mentee-nov26')).toBeNull();
  });
});

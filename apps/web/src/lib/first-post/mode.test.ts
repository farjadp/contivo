import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { contentCount, policyCount } = vi.hoisted(() => ({
  contentCount: vi.fn(),
  policyCount: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { contentItem: { count: contentCount }, autopilotPolicy: { count: policyCount } },
}));

import { isGuidedMode, loadGuidedMode, readKillSwitch } from './mode';

const ORIGINAL = process.env.FIRST_POST_GUIDED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FIRST_POST_GUIDED;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FIRST_POST_GUIDED;
  else process.env.FIRST_POST_GUIDED = ORIGINAL;
});

describe('isGuidedMode', () => {
  const base = { publishedAnywhere: false, autopilotEnabledAnywhere: false, killSwitch: false };

  it('is guided for a user who has published nothing and runs no autopilot', () => {
    expect(isGuidedMode(base)).toBe(true);
  });
  it('is open once anything is published', () => {
    expect(isGuidedMode({ ...base, publishedAnywhere: true })).toBe(false);
  });
  it('is open while an autopilot is enabled', () => {
    expect(isGuidedMode({ ...base, autopilotEnabledAnywhere: true })).toBe(false);
  });
  it('is open when the kill switch is on', () => {
    expect(isGuidedMode({ ...base, killSwitch: true })).toBe(false);
  });
});

describe('readKillSwitch', () => {
  it('is on only for FIRST_POST_GUIDED=off', () => {
    expect(readKillSwitch()).toBe(false);
    process.env.FIRST_POST_GUIDED = 'on';
    expect(readKillSwitch()).toBe(false);
    process.env.FIRST_POST_GUIDED = 'off';
    expect(readKillSwitch()).toBe(true);
  });
});

describe('loadGuidedMode', () => {
  it('counts published items by user and enabled policies on the user\'s workspaces', async () => {
    contentCount.mockResolvedValue(0);
    policyCount.mockResolvedValue(0);
    await expect(loadGuidedMode('u1')).resolves.toBe(true);
    expect(contentCount).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'PUBLISHED' } });
    expect(policyCount).toHaveBeenCalledWith({ where: { enabled: true, workspace: { userId: 'u1' } } });
  });

  it('is open with one published item anywhere', async () => {
    contentCount.mockResolvedValue(1);
    policyCount.mockResolvedValue(0);
    await expect(loadGuidedMode('u1')).resolves.toBe(false);
  });

  it('is open with an enabled autopilot', async () => {
    contentCount.mockResolvedValue(0);
    policyCount.mockResolvedValue(2);
    await expect(loadGuidedMode('u1')).resolves.toBe(false);
  });

  it('does not query when the kill switch is on', async () => {
    process.env.FIRST_POST_GUIDED = 'off';
    await expect(loadGuidedMode('u1')).resolves.toBe(false);
    expect(contentCount).not.toHaveBeenCalled();
    expect(policyCount).not.toHaveBeenCalled();
  });

  it('lets a database error through instead of guessing a mode', async () => {
    contentCount.mockRejectedValue(new Error('db down'));
    policyCount.mockResolvedValue(0);
    await expect(loadGuidedMode('u1')).rejects.toThrow('db down');
  });
});

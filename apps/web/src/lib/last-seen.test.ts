import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Session semantics (head-of-data, 2026-11-21): a session starts on the first
// signed-in request after >= 30 min idle, or the first ever; lastSeenAt is
// written at most once per 5 minutes. No database: prisma and the activity
// log are mocked.

const { queryRawMock, writeActivityLogMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  writeActivityLogMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRawMock } }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: writeActivityLogMock }));

import { touchLastSeen } from './last-seen';

const MINUTE = 60_000;
let clock = Date.parse('2026-11-22T09:00:00Z');
let nextUser = 0;
const freshUser = () => `user-${++nextUser}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  clock += 24 * 60 * MINUTE;
});

describe('touchLastSeen', () => {
  it('starts a session on the first ever request', async () => {
    const userId = freshUser();
    queryRawMock.mockResolvedValueOnce([{ previous: null, sessionStarted: true }]);

    await touchLastSeen(userId);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(writeActivityLogMock).toHaveBeenCalledWith({
      userId,
      action: 'SESSION_STARTED',
      detail: { previousSeenAt: null },
    });
  });

  it('does not start a session when the user was seen under 30 minutes ago', async () => {
    queryRawMock.mockResolvedValueOnce([{ previous: new Date(clock - 10 * MINUTE), sessionStarted: false }]);

    await touchLastSeen(freshUser());

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(writeActivityLogMock).not.toHaveBeenCalled();
  });

  it('starts a session after 30 minutes or more idle', async () => {
    const userId = freshUser();
    const previous = new Date(clock - 45 * MINUTE);
    queryRawMock.mockResolvedValueOnce([{ previous, sessionStarted: true }]);

    await touchLastSeen(userId);

    expect(writeActivityLogMock).toHaveBeenCalledWith({
      userId,
      action: 'SESSION_STARTED',
      detail: { previousSeenAt: previous.toISOString() },
    });
  });

  it('writes nothing when the database says lastSeenAt is fresh (row not updated)', async () => {
    queryRawMock.mockResolvedValueOnce([]);

    await touchLastSeen(freshUser());

    expect(writeActivityLogMock).not.toHaveBeenCalled();
  });

  it('skips the database entirely for 5 minutes after a touch in this process', async () => {
    const userId = freshUser();
    queryRawMock.mockResolvedValue([{ previous: null, sessionStarted: true }]);

    await touchLastSeen(userId);
    clock += 4 * MINUTE;
    await touchLastSeen(userId);
    expect(queryRawMock).toHaveBeenCalledTimes(1);

    clock += 2 * MINUTE;
    queryRawMock.mockResolvedValue([]);
    await touchLastSeen(userId);
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(writeActivityLogMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the database does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryRawMock.mockRejectedValueOnce(new Error('db down'));

    await expect(touchLastSeen(freshUser())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(writeActivityLogMock).not.toHaveBeenCalled();
  });

  it('ignores an empty user id', async () => {
    await touchLastSeen('');
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});

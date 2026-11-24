import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { afterMock, runFirstPostMock, readRunStartedMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
  runFirstPostMock: vi.fn(),
  readRunStartedMock: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: afterMock };
});
vi.mock('@/lib/first-post/run', () => ({ runFirstPost: runFirstPostMock }));
vi.mock('@/lib/first-post/run-log', () => ({ readRunStarted: readRunStartedMock }));

import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const SECRET = 'the-real-secret';

function request(headers: Record<string, string> = {}, body: unknown = { runId: 'fpr_ws1_1' }) {
  return new Request('https://internal.example.com/api/first-post/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  readRunStartedMock.mockResolvedValue({ runId: 'fpr_ws1_1', userId: 'u1', workspaceId: 'ws1', kind: 'start' });
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe('POST /api/first-post/run', () => {
  it('fails closed when CRON_SECRET is unset (503, same as /api/matrices/run), even with a header', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(request({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(503);
    expect(afterMock).not.toHaveBeenCalled();
    expect(readRunStartedMock).not.toHaveBeenCalled();
  });

  it('401 without a header, with a wrong secret, or without the Bearer prefix', async () => {
    const cases: Array<Record<string, string>> = [{}, { authorization: 'Bearer the-wrong-secret' }, { authorization: SECRET }];
    for (const headers of cases) {
      const res = await POST(request(headers));
      expect(res.status).toBe(401);
    }
    expect(afterMock).not.toHaveBeenCalled();
    expect(readRunStartedMock).not.toHaveBeenCalled();
  });

  it('401, not 500, for a non-ASCII secret of the same character length', async () => {
    const res = await POST(request({ authorization: `Bearer ${'é'.repeat(SECRET.length)}` }));
    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('202 and after() runs runFirstPost with the run id from the row', async () => {
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(202);
    expect(readRunStartedMock).toHaveBeenCalledWith('fpr_ws1_1');
    expect(afterMock).toHaveBeenCalledTimes(1);
    await (afterMock.mock.calls[0][0] as () => unknown)();
    expect(runFirstPostMock).toHaveBeenCalledWith('fpr_ws1_1');
  });

  it('only runId is read from the body: a workspaceId there changes nothing', async () => {
    await POST(request({ authorization: `Bearer ${SECRET}` }, { runId: 'fpr_ws1_1', workspaceId: 'someone-else' }));
    await (afterMock.mock.calls[0][0] as () => unknown)();
    expect(runFirstPostMock).toHaveBeenCalledTimes(1);
    expect(runFirstPostMock.mock.calls[0]).toEqual(['fpr_ws1_1']);
  });

  it('an unknown id, or a row that is not FIRST_POST_RUN_STARTED, runs nothing', async () => {
    readRunStartedMock.mockResolvedValue(null);
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }, { runId: 'some-other-log-row' }));
    expect(res.status).toBe(404);
    expect(afterMock).not.toHaveBeenCalled();
    expect(runFirstPostMock).not.toHaveBeenCalled();
  });

  it('400 for a missing runId or a body that is not JSON', async () => {
    expect((await POST(request({ authorization: `Bearer ${SECRET}` }, {}))).status).toBe(400);
    expect((await POST(request({ authorization: `Bearer ${SECRET}` }, '{not json'))).status).toBe(400);
    expect(afterMock).not.toHaveBeenCalled();
  });
});

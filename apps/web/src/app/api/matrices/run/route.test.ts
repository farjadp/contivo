import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `after()` requires a Next.js request-scoped context that does not exist in
// a plain vitest run, so it is mocked here to just capture the callback —
// everything else (`NextResponse`) is the real implementation, which needs
// no request context.
const { afterMock, runMatrixPipelineMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
  runMatrixPipelineMock: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: afterMock };
});

vi.mock('@/lib/matrices/pipeline', () => ({ runMatrixPipeline: runMatrixPipelineMock }));

import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}, body: unknown = { runId: 'run-1' }) {
  return new Request('https://internal.example.com/api/matrices/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

describe('POST /api/matrices/run', () => {
  it('fails closed with 503 when CRON_SECRET is not configured, even with a header that would otherwise match', async () => {
    delete process.env.CRON_SECRET;

    const res = await POST(request({ authorization: 'Bearer anything' }));

    expect(res.status).toBe(503);
    expect(afterMock).not.toHaveBeenCalled();
    expect(runMatrixPipelineMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no authorization header at all', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    const res = await POST(request({ authorization: 'Bearer the-wrong-secret' }));

    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('rejects a request missing the "Bearer " prefix', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    const res = await POST(request({ authorization: 'the-real-secret' }));

    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('accepts the correct bearer secret, returns 202 immediately, and schedules the pipeline via after()', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    const res = await POST(request({ authorization: 'Bearer the-real-secret' }, { runId: 'run-42' }));

    expect(res.status).toBe(202);
    expect(afterMock).toHaveBeenCalledTimes(1);

    // The route hands after() a callback rather than calling the pipeline
    // itself — invoke what was scheduled and check it runs the right run.
    const scheduled = afterMock.mock.calls[0][0] as () => unknown;
    await scheduled();
    expect(runMatrixPipelineMock).toHaveBeenCalledWith('run-42');
  });

  it('never accepts a workspaceId from the request body — only runId reaches the pipeline', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    await POST(
      request(
        { authorization: 'Bearer the-real-secret' },
        { runId: 'run-42', workspaceId: 'someone-elses-workspace' },
      ),
    );

    const scheduled = afterMock.mock.calls[0][0] as () => unknown;
    await scheduled();
    expect(runMatrixPipelineMock).toHaveBeenCalledWith('run-42');
    expect(runMatrixPipelineMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: expect.anything() }),
    );
  });

  it('rejects a body with no runId', async () => {
    process.env.CRON_SECRET = 'the-real-secret';

    const res = await POST(request({ authorization: 'Bearer the-real-secret' }, {}));

    expect(res.status).toBe(400);
    expect(afterMock).not.toHaveBeenCalled();
  });
});

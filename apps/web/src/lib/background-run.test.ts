import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { triggerBackgroundRun } from './background-run';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of ['WEB_APP_URL', 'NEXT_PUBLIC_APP_URL', 'PORT', 'CRON_SECRET']) {
    delete process.env[key];
  }
}

beforeEach(() => {
  resetEnv();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('triggerBackgroundRun', () => {
  it('reports failure, without attempting a fetch, when CRON_SECRET is unset', async () => {
    process.env.WEB_APP_URL = 'https://app.example.com';

    const result = await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(result).toEqual({ ok: false, error: 'CRON_SECRET is not set' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prefers WEB_APP_URL when it is set', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.WEB_APP_URL = 'https://prod.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 202 }));

    await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(fetch).toHaveBeenCalledWith(
      'https://prod.example.com/api/growth/discovery/run',
      expect.any(Object),
    );
  });

  it('falls back to NEXT_PUBLIC_APP_URL when WEB_APP_URL is unset', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 202 }));

    await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(fetch).toHaveBeenCalledWith(
      'https://public.example.com/api/growth/discovery/run',
      expect.any(Object),
    );
  });

  it('falls back to http://localhost:<PORT> when neither URL env var is set', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.PORT = '4321';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 202 }));

    await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:4321/api/growth/discovery/run', expect.any(Object));
  });

  it('falls back to http://localhost:3000 when nothing at all is set', async () => {
    process.env.CRON_SECRET = 'secret';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 202 }));

    await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/growth/discovery/run', expect.any(Object));
  });

  it('reports failure on a non-2xx response from the route', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.WEB_APP_URL = 'https://app.example.com';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 500 }));

    const result = await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(result).toEqual({ ok: false, error: 'Background route responded 500' });
  });

  it('reports failure, not a thrown error, when the fetch itself throws (e.g. connection refused)', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.WEB_APP_URL = 'https://app.example.com';
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('reports success on a 2xx response', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.WEB_APP_URL = 'https://app.example.com';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 202 }));

    const result = await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect(result).toEqual({ ok: true });
  });

  it('never puts CRON_SECRET in the returned error text', async () => {
    // Unset case: the error string must name the env var, not its value
    // (there is no value yet, but this guards against a future edit that
    // starts interpolating `secret` into the message).
    process.env.WEB_APP_URL = 'https://app.example.com';

    const result = await triggerBackgroundRun('/api/growth/discovery/run', { runId: 'r1' });

    expect('error' in result ? result.error : '').not.toContain('undefined');
  });
});

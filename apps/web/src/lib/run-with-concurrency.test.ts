import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './run-with-concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(Math.random() * 20);
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects when a task throws, after in-flight tasks settle', async () => {
    let finished = 0;
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 1) throw new Error('boom');
        await sleep(15);
        finished++;
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(finished).toBe(1);
  });

  it('handles an empty list', async () => {
    expect(await runWithConcurrency([], 3, async (n) => n)).toEqual([]);
  });
});

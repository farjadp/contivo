/**
 * Runs `task` over `items` with at most `concurrency` in flight.
 *
 * Results come back in input order. On the first failure no new task starts,
 * and the returned promise rejects once the tasks already running have settled,
 * so nothing keeps working (and spending) behind a caller that has moved on.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };

  const width = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  if (failed) throw firstError;
  return results;
}

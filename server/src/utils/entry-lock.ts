/**
 * In-process async mutex that serializes tasks by key (promise-chain based).
 *
 * Purpose: prevent concurrent read-modify-write races on the same memory
 * entry (update/append/overwrite).
 * Implementation: each key keeps one promise chain; tasks arriving later run
 * after the previous one, whether it succeeded or failed (a failure does not
 * block subsequent tasks).
 * Cleanup: the chain entry is removed once the last waiter completes, keeping
 * the map from growing without bound.
 *
 * Limitation: only effective within a single process instance; multi-instance
 * deployments need a Redis distributed lock instead.
 * Timeout safety net: embedding calls inside the lock carry their own 10s
 * timeout (see the embedding module), so lock hold time is bounded.
 */
const chains = new Map<string, Promise<unknown>>();

export function withEntryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // .then(fn, fn): run this task whether the previous one succeeded or failed
  const run = prev.then(fn, fn);
  // Tail for later tasks to chain onto: swallow the error so the chain never breaks
  const tail = run.catch(() => {});
  chains.set(key, tail);
  return run.finally(() => {
    // Only clean up when this is still the tail (new tasks may have chained on)
    if (chains.get(key) === tail) {
      chains.delete(key);
    }
  });
}

import { describe, expect, it } from 'vitest';
import { withEntryLock } from '../src/utils/entry-lock.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('withEntryLock', () => {
  it('tasks with the same key run serially, entering in call order', async () => {
    const order: string[] = [];
    const task = (name: string, ms: number) =>
      withEntryLock('k1', async () => {
        order.push(`${name}:start`);
        await sleep(ms);
        order.push(`${name}:end`);
      });

    await Promise.all([task('a', 30), task('b', 5), task('c', 5)]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('after a task throws, subsequent tasks still run (lock is not stuck)', async () => {
    const first = withEntryLock('k2', async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow('boom');

    const order: string[] = [];
    await withEntryLock('k2', async () => {
      order.push('second');
    });
    expect(order).toEqual(['second']);
  });

  it('errors propagate to the caller', async () => {
    await expect(
      withEntryLock('k3', async () => {
        throw new Error('propagated');
      }),
    ).rejects.toThrow('propagated');
  });

  it('tasks with different keys do not block each other', async () => {
    const order: string[] = [];
    const a = withEntryLock('ka', async () => {
      await sleep(40);
      order.push('a');
    });
    const b = withEntryLock('kb', async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['b', 'a']);
  });
});

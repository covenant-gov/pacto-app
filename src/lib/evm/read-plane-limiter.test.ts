import { describe, it, expect } from 'vitest';
import { ReadPlaneLimiter } from './read-plane-limiter';

describe('ReadPlaneLimiter', () => {
  it('caps concurrent runs and drains FIFO', async () => {
    const limiter = new ReadPlaneLimiter(2);
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const tasks = [0, 1, 2, 3].map(
      (id) => () =>
        limiter.run(async () => {
          order.push(id);
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
    );

    await Promise.all(tasks.map((t) => t()));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('dedupes are not built-in — each run is independent', async () => {
    const limiter = new ReadPlaneLimiter(1);
    let calls = 0;
    await Promise.all([
      limiter.run(async () => {
        calls++;
      }),
      limiter.run(async () => {
        calls++;
      }),
    ]);
    expect(calls).toBe(2);
  });
});

/** Cap concurrent viem / RPC reads to avoid stampedes on treasury and settings tabs. */

export const DEFAULT_READ_PLANE_CONCURRENCY = 3;

type QueueSlot = { release: () => void };

export class ReadPlaneLimiter {
  private active = 0;
  private readonly queue: QueueSlot[] = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) throw new Error('ReadPlaneLimiter maxConcurrent must be >= 1');
  }

  /** Runs `fn` when a concurrency slot is available. FIFO queue order. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        void fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            const next = this.queue.shift();
            if (next) next.release();
          });
      };

      if (this.active < this.maxConcurrent) start();
      else this.queue.push({ release: start });
    });
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }
}

export const readPlaneLimiter = new ReadPlaneLimiter(DEFAULT_READ_PLANE_CONCURRENCY);

export function withReadPlaneLimit<T>(fn: () => Promise<T>): Promise<T> {
  return readPlaneLimiter.run(fn);
}

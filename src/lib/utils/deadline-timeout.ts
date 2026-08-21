/** Max delay per `setTimeout` call (2^31 - 1 ms ≈ 24.855 days). */
export const MAX_SET_TIMEOUT_MS = 2 ** 31 - 1;

/** Schedule repeated ticks until `deadlineSec`; returns cleanup. */
export function scheduleDeadlineTimeout(deadlineSec: number, onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const remainingMs = deadlineSec * 1000 - Date.now();
    if (remainingMs <= 0) {
      onTick();
      return;
    }
    timer = setTimeout(() => {
      onTick();
      if (deadlineSec * 1000 > Date.now()) schedule();
    }, Math.min(remainingMs, MAX_SET_TIMEOUT_MS));
  };
  schedule();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}

import type { Component } from 'svelte';

/** Cache a resolved import; drop it if the load rejects so a retry can run. */
export function createLazyComponent<P extends Record<string, unknown>>(
  loader: () => Promise<{ default: Component<P> }>,
): () => Promise<Component<P>> {
  let cached: Promise<{ default: Component<P> }> | null = null;
  return () => {
    if (!cached) {
      const pending = loader().then(
        (mod) => mod,
        (err: unknown) => {
          if (cached === pending) cached = null;
          throw err;
        },
      );
      cached = pending;
    }
    return cached.then((m) => m.default);
  };
}

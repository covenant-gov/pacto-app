import type { Component } from 'svelte';

/** Cache the dynamic import promise; reuse the resolved component across mounts. */
export function createLazyComponent<P extends Record<string, unknown>>(
  loader: () => Promise<{ default: Component<P> }>,
): () => Promise<Component<P>> {
  let cached: Promise<{ default: Component<P> }> | null = null;
  return () => {
    if (!cached) cached = loader();
    return cached.then((m) => m.default);
  };
}

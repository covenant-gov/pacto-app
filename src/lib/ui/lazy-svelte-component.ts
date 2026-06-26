import type { Component } from 'svelte';

type SvelteModule = { default: Component };

/** Cache the dynamic import promise; reuse the resolved component across mounts. */
export function createLazyComponent(loader: () => Promise<SvelteModule>): () => Promise<Component> {
  let cached: Promise<SvelteModule> | null = null;
  return () => {
    if (!cached) cached = loader();
    return cached.then((m) => m.default);
  };
}

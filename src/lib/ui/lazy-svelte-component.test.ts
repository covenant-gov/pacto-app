import { describe, it, expect, vi } from 'vitest';
import { createLazyComponent } from './lazy-svelte-component';

describe('lazy-svelte-component', () => {
  it('reuses the same import promise', async () => {
    const loader = vi.fn().mockResolvedValue({ default: class {} });
    const load = createLazyComponent(loader);
    await load();
    await load();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

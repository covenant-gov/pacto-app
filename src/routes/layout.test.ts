import { describe, it, expect } from 'vitest';
import { ssr } from './+layout';

describe('+layout', () => {
  it('disables SSR for Tauri static SPA mode', () => {
    expect(ssr).toBe(false);
  });
});

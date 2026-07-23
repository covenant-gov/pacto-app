import { defineConfig } from 'vite';
import baseConfig from './vite.config.ts';

/**
 * Agent browser build: static SPA with mocked backend.
 * Emits to build-agent/ so pnpm build/ stays unchanged.
 */
export default defineConfig({
  ...baseConfig,
  test: undefined,
});

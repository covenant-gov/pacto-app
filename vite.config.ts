import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

const host = process.env.TAURI_DEV_HOST;

const plugins = await sveltekit();

// https://vite.dev/config/ — Vitest uses the same file (see `test` below).
export default defineConfig({
  plugins: Array.isArray(plugins) ? plugins : [plugins],

  /** Expose `ALCHEMY_RPC_KEY` to the client (same var the Tauri backend reads). */
  envPrefix: ['VITE_', 'ALCHEMY_'],

  clearScreen: false,

  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        'src/app.html',
        'src/app.css',
        'src/**/*.svelte',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});

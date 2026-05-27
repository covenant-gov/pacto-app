import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/ — Vitest uses the same file (see `test` below).
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  /** Expose `ALCHEMY_RPC_KEY` to the client (same var the Tauri backend reads). */
  envPrefix: ['VITE_', 'ALCHEMY_'],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));

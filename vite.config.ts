import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';
import packageJson from './package.json' with { type: 'json' };

const host = process.env.TAURI_DEV_HOST;

const plugins = await sveltekit();

function getCommitHash(): string {
  if (process.env.VITE_COMMIT_HASH) {
    return process.env.VITE_COMMIT_HASH.trim();
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getAppVersion(): string {
  const version = process.env.VITE_APP_VERSION ?? packageJson.version;
  return version.startsWith('v') ? version : `v${version}`;
}

// https://vite.dev/config/ — Vitest uses the same file (see `test` below).
export default defineConfig({
  plugins: Array.isArray(plugins) ? plugins : [plugins],

  /** Expose `ALCHEMY_RPC_KEY` to the client (same var the Tauri backend reads). */
  envPrefix: ['VITE_', 'ALCHEMY_'],

  define: {
    __APP_COMMIT_HASH__: JSON.stringify(getCommitHash()),
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },

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

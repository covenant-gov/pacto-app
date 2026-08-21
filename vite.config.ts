import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import packageJson from './package.json' with { type: 'json' };
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import {
	hideDesignRoutes,
	omitDesignPlaygroundPlugin,
	restoreDesignRoutes,
} from './scripts/omit-design-playground.ts';

hideDesignRoutes();
process.on('exit', restoreDesignRoutes);

const host = process.env.TAURI_DEV_HOST;

// Branch-hashed dev port set (scripts/dev-ports.mjs); defaults reproduce
// today's fixed ports when unset (plain `pnpm dev`, `main` via `make dev`).
const devPort = Number(process.env.PACTO_DEV_PORT) || 1420;
const hmrPort = Number(process.env.PACTO_DEV_HMR_PORT) || 1421;

const plugins = await sveltekit();

const tauriConf = JSON.parse(fs.readFileSync('./src-tauri/tauri.conf.json', 'utf8'));

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
  // Prefer the explicit build-time override, then the Tauri app version (the
  // source of truth for the bundle), then package.json as a last resort.
  const raw = process.env.VITE_APP_VERSION ?? tauriConf.version ?? packageJson.version;
  const version = raw.startsWith('v') ? raw : `v${raw}`;

  if (!/^v\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      `Invalid app version "${version}". Expected a semver like "v0.2.0". ` +
        `Check VITE_APP_VERSION, src-tauri/tauri.conf.json, and package.json.`
    );
  }

  return version;
}

// https://vite.dev/config/ — Vitest uses the same file (see `test` below).
export default defineConfig({
  plugins: Array.isArray(plugins)
    ? [omitDesignPlaygroundPlugin(), ...plugins, tailwindcss(), svelteTesting()]
    : [omitDesignPlaygroundPlugin(), plugins, tailwindcss(), svelteTesting()],

  /** Expose `ALCHEMY_RPC_KEY` to the client (same var the Tauri backend reads). */
  envPrefix: ['VITE_', 'ALCHEMY_'],

  define: {
    __APP_COMMIT_HASH__: JSON.stringify(getCommitHash()),
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },

  clearScreen: false,

  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // A dev sandbox writes its app log, SQLite database and MLS store under
      // test_sandbox/ (make dev-sandbox) or test_fixtures/ (make dev,
      // dev-account, dev-buddy) while the dev server is up, and a git worktree
      // nests a whole second checkout under .worktrees/. Watching any of them
      // feeds the running app's own disk churn back in as source changes.
      //
      // The worktrees pattern is anchored to this checkout: patterns match
      // absolute paths, so a bare '**/.worktrees/**' would make a dev server
      // running *inside* a worktree ignore its own sources (serving fine, HMR
      // silently dead).
      ignored: [
        '**/src-tauri/**',
        '**/build-agent/**',
        '**/test_sandbox/**',
        '**/test_fixtures/**',
        `${fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/')}.worktrees/**`,
      ],
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
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

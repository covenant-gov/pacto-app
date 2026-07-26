import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config.ts';

/**
 * Agent browser build: static SPA with mocked backend.
 * Emits to build-agent/ so pnpm build/ stays unchanged.
 */
export default defineConfig({
  ...baseConfig,
  test: undefined,
  resolve: {
    alias: {
      // The real plugin talks to the OS-native file picker over Tauri IPC, which doesn't exist
      // in this browser-only build; substitute a fixed-path mock so picker-driven flows (e.g.
      // "Change avatar") are exercisable in Playwright. See src/lib/api/mock-dialog.ts.
      '@tauri-apps/plugin-dialog': fileURLToPath(new URL('./src/lib/api/mock-dialog.ts', import.meta.url)),
    },
  },
});

/**
 * Browser-preview mock for `@tauri-apps/plugin-dialog`. The real plugin talks to the OS-native
 * file picker over Tauri IPC, which doesn't exist in the browser-only agent build (see
 * vite.config.agent.ts's alias). Returns a fixed fake path so picker-driven flows (e.g. "Change
 * avatar") are exercisable in Playwright without a real OS dialog; downstream mock command
 * fixtures (src/lib/api/mock-fixtures.ts) don't read this path, they return canned data.
 */
export async function open(): Promise<string | null> {
  return '/mock/avatar-source.jpg';
}

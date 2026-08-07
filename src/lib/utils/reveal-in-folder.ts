import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';

const IS_SERVER = typeof window === 'undefined' || typeof navigator === 'undefined';

/** True when the reveal-in-folder affordance is available (Tauri desktop). */
export function canRevealInFolder(): boolean {
  return (
    !IS_SERVER &&
    !!(window as Window & { __TAURI__?: unknown }).__TAURI__ &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/**
 * Reveal a local file in its parent folder on desktop.
 * Falls back to opening the file itself when reveal is unavailable.
 */
export async function revealInFolder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch {
    await openPath(path);
  }
}

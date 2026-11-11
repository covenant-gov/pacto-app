import type { NostrProfile } from '../api/nostr';
import { getOwnProfileTitleName } from '../utils/profile';

export const APP_WINDOW_TITLE_BASE = 'Pacto';

const TITLE_NAME_SEP = ' · ';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

/** OS window title: `Pacto` or `Pacto · {name}` when Settings header would show a name. */
export function formatAppWindowTitle(profileName: string | null | undefined): string {
  const name = profileName?.trim();
  if (!name) return APP_WINDOW_TITLE_BASE;
  return `${APP_WINDOW_TITLE_BASE}${TITLE_NAME_SEP}${name}`;
}

export async function syncAppWindowTitle(profile: NostrProfile | null | undefined): Promise<void> {
  if (!isTauriRuntime()) return;
  const title = formatAppWindowTitle(getOwnProfileTitleName(profile));
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch {
    // Browser, missing capability, or pre-API runtime — ignore.
  }
}

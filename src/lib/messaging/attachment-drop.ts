import { writable } from 'svelte/store';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** True while an OS drag is hovering the webview; drives the composer's drop-target overlay. */
export const dropActive = writable(false);

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as { __TAURI__?: unknown }).__TAURI__;
}

type UnlistenFn = () => void;

// Module-level singletons so every `MessageInput` mount point shares one native listener
// instead of each registering its own `onDragDropEvent` subscription.
const pathListeners = new Set<(paths: string[]) => void>();
let nativeUnlisten: UnlistenFn | null = null;
let nativeReady: Promise<UnlistenFn> | null = null;

async function ensureNativeListener(): Promise<void> {
  if (!nativeReady) {
    nativeReady = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        dropActive.set(true);
      } else if (payload.type === 'drop') {
        dropActive.set(false);
        for (const onPaths of pathListeners) onPaths(payload.paths);
      } else {
        dropActive.set(false);
      }
    });
  }
  nativeUnlisten = await nativeReady;
}

/**
 * Subscribes to the Tauri webview drag-drop event and invokes `onPaths` with the dropped file
 * paths. Reference-counted: N concurrent registrations share one native listener, torn down
 * when the last caller unregisters. No-op outside Tauri (web/test environments).
 */
export async function registerAttachmentDrop(onPaths: (paths: string[]) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  pathListeners.add(onPaths);
  await ensureNativeListener();

  let torn = false;
  return () => {
    if (torn) return;
    torn = true;
    pathListeners.delete(onPaths);
    if (pathListeners.size === 0) {
      nativeUnlisten?.();
      nativeUnlisten = null;
      nativeReady = null;
      dropActive.set(false);
    }
  };
}

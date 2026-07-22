import { invoke as realInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as realListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { mockInvoke } from './mock-invoke';
import { mockListen } from './mock-listen';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

export type { UnlistenFn } from '@tauri-apps/api/event';

// Unit tests mock @tauri-apps/api/core directly, so keep the real exports there.
// In a plain browser preview, fall back to the mock registry.
const useMock =
  !(
    (typeof import.meta.env !== 'undefined' && import.meta.env.VITEST) ||
    (typeof process !== 'undefined' && process.env?.VITEST)
  ) &&
  typeof window !== 'undefined' &&
  !window.__TAURI__;

export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (useMock) {
    return mockInvoke<T>(command, args);
  }
  return args ? realInvoke<T>(command, args) : realInvoke<T>(command);
}

export async function listen<T>(
  event: string,
  handler: EventCallback<T>
): Promise<UnlistenFn> {
  if (useMock) {
    return mockListen<T>(event, handler);
  }
  return realListen<T>(event, handler);
}

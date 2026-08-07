import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event';

export async function mockListen<T>(
  _event: string,
  _handler: EventCallback<T>
): Promise<UnlistenFn> {
  return () => {};
}

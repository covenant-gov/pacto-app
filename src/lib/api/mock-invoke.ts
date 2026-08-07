import type { InvokeArgs } from '@tauri-apps/api/core';
import { mockCommandRegistry } from './mock-registry';

export type MockCommandHandler = (args: Record<string, unknown>) => unknown;

function normalizeArgs(args: InvokeArgs | undefined): Record<string, unknown> {
  if (args && typeof args === 'object' && !(args instanceof Uint8Array)) {
    return args as Record<string, unknown>;
  }
  return {};
}

export async function mockInvoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  const handler = mockCommandRegistry[command];
  if (!handler) {
    throw new Error(`Unmocked backend command: ${command}`);
  }
  const result = await Promise.resolve(handler(normalizeArgs(args)));
  return result as T;
}

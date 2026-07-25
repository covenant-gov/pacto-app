// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { dropActive, registerAttachmentDrop } from './attachment-drop';

type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: unknown }
  | { type: 'over'; position: unknown }
  | { type: 'drop'; paths: string[]; position: unknown }
  | { type: 'leave' };

let capturedHandler: ((event: { payload: DragDropPayload }) => void) | undefined;
const mockUnlisten = vi.fn();
const mockOnDragDropEvent = vi.fn((handler: (event: { payload: DragDropPayload }) => void) => {
  capturedHandler = handler;
  return Promise.resolve(mockUnlisten);
});

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mockOnDragDropEvent,
  }),
}));

function setTauri(enabled: boolean): void {
  const win = window as Window & { __TAURI__?: unknown };
  if (enabled) {
    win.__TAURI__ = {};
  } else {
    delete win.__TAURI__;
  }
}

beforeEach(() => {
  capturedHandler = undefined;
  mockOnDragDropEvent.mockClear();
  mockUnlisten.mockClear();
  dropActive.set(false);
  setTauri(false);
});

afterEach(() => {
  setTauri(false);
});

describe('attachment-drop', () => {
  it('is a no-op outside Tauri', async () => {
    const onPaths = vi.fn();
    const unregister = await registerAttachmentDrop(onPaths);
    expect(mockOnDragDropEvent).not.toHaveBeenCalled();
    expect(() => unregister()).not.toThrow();
  });

  it('shares exactly one native listener across concurrent registrations', async () => {
    setTauri(true);
    const onPathsA = vi.fn();
    const onPathsB = vi.fn();
    const [unregisterA, unregisterB] = await Promise.all([
      registerAttachmentDrop(onPathsA),
      registerAttachmentDrop(onPathsB),
    ]);
    expect(mockOnDragDropEvent).toHaveBeenCalledTimes(1);

    unregisterA();
    expect(mockUnlisten).not.toHaveBeenCalled();

    unregisterB();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it('registers a fresh native listener after a full teardown', async () => {
    setTauri(true);
    const first = await registerAttachmentDrop(vi.fn());
    first();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);

    const second = await registerAttachmentDrop(vi.fn());
    expect(mockOnDragDropEvent).toHaveBeenCalledTimes(2);
    second();
  });

  it('toggles dropActive on enter/over/leave and clears it on drop', async () => {
    setTauri(true);
    const onPaths = vi.fn();
    const unregister = await registerAttachmentDrop(onPaths);
    expect(capturedHandler).toBeDefined();

    capturedHandler?.({ payload: { type: 'enter', paths: ['/tmp/a.png'], position: {} } });
    expect(get(dropActive)).toBe(true);

    capturedHandler?.({ payload: { type: 'leave' } });
    expect(get(dropActive)).toBe(false);

    capturedHandler?.({ payload: { type: 'over', position: {} } });
    expect(get(dropActive)).toBe(true);

    capturedHandler?.({ payload: { type: 'drop', paths: ['/tmp/a.png', '/tmp/b.png'], position: {} } });
    expect(get(dropActive)).toBe(false);
    expect(onPaths).toHaveBeenCalledWith(['/tmp/a.png', '/tmp/b.png']);

    unregister();
  });

  it('fans a drop out to every registered listener', async () => {
    setTauri(true);
    const onPathsA = vi.fn();
    const onPathsB = vi.fn();
    const unregisterA = await registerAttachmentDrop(onPathsA);
    const unregisterB = await registerAttachmentDrop(onPathsB);

    capturedHandler?.({ payload: { type: 'drop', paths: ['/tmp/shared.png'], position: {} } });
    expect(onPathsA).toHaveBeenCalledWith(['/tmp/shared.png']);
    expect(onPathsB).toHaveBeenCalledWith(['/tmp/shared.png']);

    unregisterA();
    unregisterB();
  });
});

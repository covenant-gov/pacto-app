// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DmMessage } from '../../stores/dm';

const mockRequestLinkPreview = vi.fn();

vi.mock('./link-preview', () => ({
  requestLinkPreview: (...args: unknown[]) => mockRequestLinkPreview(...args),
}));

type ObserverCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

let capturedCallback: ObserverCallback | undefined;
let capturedOptions: IntersectionObserverInit | undefined;
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    capturedCallback = callback;
    capturedOptions = options;
  }
  observe = mockObserve;
  unobserve = mockUnobserve;
  disconnect = vi.fn();
}

function msg(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'check https://example.com out',
    at: 0,
    mine: false,
    ...overrides,
  };
}

type GlobalWithIntersectionObserver = typeof globalThis & { IntersectionObserver?: unknown };
const globalWithIO = global as GlobalWithIntersectionObserver;

/** Fresh module import per test so the module-level observer singleton doesn't leak state. */
async function loadObserveLinkPreview() {
  vi.resetModules();
  const mod = await import('./link-preview-observer');
  return mod.observeLinkPreview;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCallback = undefined;
  capturedOptions = undefined;
  globalWithIO.IntersectionObserver = FakeIntersectionObserver;
});

describe('observeLinkPreview', () => {
  it('does not request a preview before the node intersects', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(mockObserve).toHaveBeenCalledWith(node);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
  });

  it('requests a preview once the node is reported intersecting', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledWith('chat1', msg());
  });

  it('uses a 200px lookahead margin and zero threshold', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(capturedOptions).toEqual({ rootMargin: '200px 0px', threshold: 0 });
  });

  it('does not request again on a second intersection callback for the same node', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledTimes(1);
    expect(mockUnobserve).toHaveBeenCalledWith(node);
  });

  it('ignores non-intersecting entries', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: false, target: node }]);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
    expect(mockUnobserve).not.toHaveBeenCalled();
  });

  it('no-ops when params are undefined at intersection time', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, undefined);
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
  });

  it('update() replaces params used for the next intersection check', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    const action = observeLinkPreview(node, undefined);
    action.update({ chatId: 'chat2', message: msg({ id: 'm2' }) });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledWith('chat2', msg({ id: 'm2' }));
  });

  it('destroy() unobserves the node', async () => {
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    const action = observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    action.destroy();
    expect(mockUnobserve).toHaveBeenCalledWith(node);
  });

  it('is a no-op when IntersectionObserver is unavailable', async () => {
    delete globalWithIO.IntersectionObserver;
    const observeLinkPreview = await loadObserveLinkPreview();
    const node = document.createElement('div');
    expect(() => observeLinkPreview(node, { chatId: 'chat1', message: msg() })).not.toThrow();
    const action = observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(() => action.destroy()).not.toThrow();
    expect(mockObserve).not.toHaveBeenCalled();
  });
});

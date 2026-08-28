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

/** Narrow view of the global so the test can install a fake and delete it; `typeof globalThis`
 * types `IntersectionObserver` as required, which blocks both. */
const globalWithIO = global as unknown as { IntersectionObserver?: unknown };

/** Dynamic import is required here, not just conventional: `vi.resetModules()` must run first so
 * each test gets a fresh copy of the observer's module-level singleton state (and the real
 * `webPreviewsEnabled` store it subscribes to) instead of leaking state across tests. */
async function loadObserveLinkPreview() {
  vi.resetModules();
  const mod = await import('./link-preview-observer');
  const storeMod = await import('../../stores/web-previews');
  return { observeLinkPreview: mod.observeLinkPreview, webPreviewsEnabled: storeMod.webPreviewsEnabled };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Matches the real `requestLinkPreview` default: most outcomes are permanent (queued, or the
  // message will never get a preview). Individual tests override this to simulate the one
  // non-permanent outcome (the "Web Previews" setting being off).
  mockRequestLinkPreview.mockReturnValue(true);
  capturedCallback = undefined;
  capturedOptions = undefined;
  globalWithIO.IntersectionObserver = FakeIntersectionObserver;
});

describe('observeLinkPreview', () => {
  it('does not request a preview before the node intersects', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(mockObserve).toHaveBeenCalledWith(node);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
  });

  it('requests a preview once the node is reported intersecting', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledWith('chat1', msg());
  });

  it('uses a 200px lookahead margin and zero threshold', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(capturedOptions).toEqual({ rootMargin: '200px 0px', threshold: 0 });
  });

  it('does not request again on a second intersection callback for the same node', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledTimes(1);
    expect(mockUnobserve).toHaveBeenCalledWith(node);
  });

  it('ignores non-intersecting entries', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    capturedCallback?.([{ isIntersecting: false, target: node }]);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
    expect(mockUnobserve).not.toHaveBeenCalled();
  });

  it('no-ops when params are undefined at intersection time', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    observeLinkPreview(node, undefined);
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).not.toHaveBeenCalled();
  });

  it('update() replaces params used for the next intersection check', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    const action = observeLinkPreview(node, undefined);
    action.update({ chatId: 'chat2', message: msg({ id: 'm2' }) });
    capturedCallback?.([{ isIntersecting: true, target: node }]);
    expect(mockRequestLinkPreview).toHaveBeenCalledWith('chat2', msg({ id: 'm2' }));
  });

  it('destroy() unobserves the node', async () => {
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    const action = observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    action.destroy();
    expect(mockUnobserve).toHaveBeenCalledWith(node);
  });

  it('is a no-op when IntersectionObserver is unavailable', async () => {
    delete globalWithIO.IntersectionObserver;
    const { observeLinkPreview } = await loadObserveLinkPreview();
    const node = document.createElement('div');
    expect(() => observeLinkPreview(node, { chatId: 'chat1', message: msg() })).not.toThrow();
    const action = observeLinkPreview(node, { chatId: 'chat1', message: msg() });
    expect(() => action.destroy()).not.toThrow();
    expect(mockObserve).not.toHaveBeenCalled();
  });

  describe('when requestLinkPreview reports a non-permanent outcome (Web Previews disabled)', () => {
    it('keeps watching the node instead of unobserving it', async () => {
      mockRequestLinkPreview.mockReturnValue(false);
      const { observeLinkPreview } = await loadObserveLinkPreview();
      const node = document.createElement('div');
      observeLinkPreview(node, { chatId: 'chat1', message: msg() });
      capturedCallback?.([{ isIntersecting: true, target: node }]);
      expect(mockRequestLinkPreview).toHaveBeenCalledTimes(1);
      expect(mockUnobserve).not.toHaveBeenCalled();
    });

    it('retries automatically once the Web Previews setting is re-enabled', async () => {
      mockRequestLinkPreview.mockReturnValue(false);
      const { observeLinkPreview, webPreviewsEnabled } = await loadObserveLinkPreview();
      // Store defaults to true; must actually flip to false so the later set(true) is a real
      // transition — Svelte stores skip notifying subscribers when set() doesn't change the value.
      webPreviewsEnabled.set(false);
      const node = document.createElement('div');
      observeLinkPreview(node, { chatId: 'chat1', message: msg() });
      capturedCallback?.([{ isIntersecting: true, target: node }]);
      expect(mockRequestLinkPreview).toHaveBeenCalledTimes(1);
      expect(mockUnobserve).not.toHaveBeenCalled();

      mockRequestLinkPreview.mockReturnValue(true);
      webPreviewsEnabled.set(true);
      expect(mockRequestLinkPreview).toHaveBeenCalledTimes(2);
      expect(mockUnobserve).toHaveBeenCalledWith(node);
    });

    it('does not retry a node that was already destroyed', async () => {
      mockRequestLinkPreview.mockReturnValue(false);
      const { observeLinkPreview, webPreviewsEnabled } = await loadObserveLinkPreview();
      webPreviewsEnabled.set(false);
      const node = document.createElement('div');
      const action = observeLinkPreview(node, { chatId: 'chat1', message: msg() });
      capturedCallback?.([{ isIntersecting: true, target: node }]);
      action.destroy();

      mockRequestLinkPreview.mockReturnValue(true);
      webPreviewsEnabled.set(true);
      expect(mockRequestLinkPreview).toHaveBeenCalledTimes(1);
    });

  });
});

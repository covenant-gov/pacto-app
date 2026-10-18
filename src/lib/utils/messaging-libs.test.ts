/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ensureMessagingLibs', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    vi.resetModules();
    delete (window as { marked?: unknown }).marked;
    delete (window as { hljs?: unknown }).hljs;
    delete (window as { twemoji?: unknown }).twemoji;
    delete (window as { DOMPurify?: unknown }).DOMPurify;
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('injects the four messaging scripts once', async () => {
    const { ensureMessagingLibs } = await import('./messaging-libs');

    const appendSpy = vi.spyOn(document.head, 'appendChild');
    appendSpy.mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      queueMicrotask(() => {
        script.dataset.loaded = '1';
        (window as { marked?: object }).marked = { use() {}, parse: () => '' };
        (window as { hljs?: object }).hljs = { highlight: () => ({ value: '' }) };
        (window as { twemoji?: object }).twemoji = {
          replace: (t: string) => t,
          convert: { toCodePoint: () => '' },
        };
        (window as { DOMPurify?: object }).DOMPurify = {
          sanitize: (s: string) => s,
          addHook() {},
          removeHook() {},
        };
        script.dispatchEvent(new Event('load'));
      });
      return HTMLElement.prototype.appendChild.call(document.head, node);
    });

    await ensureMessagingLibs();
    await ensureMessagingLibs();

    const srcs = [...document.head.querySelectorAll('script')].map((s) => s.getAttribute('src'));
    expect(srcs).toEqual([
      '/js/marked.min.js',
      '/js/highlight.min.js',
      '/js/twemoji.min.js',
      '/js/dompurify.min.js',
    ]);
  });

  it('retries with a fresh script element after a load failure', async () => {
    const { ensureMessagingLibs } = await import('./messaging-libs');

    let attempt = 0;
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    appendSpy.mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      attempt += 1;
      queueMicrotask(() => {
        if (attempt === 1) {
          script.dispatchEvent(new Event('error'));
          return;
        }
        script.dataset.loaded = '1';
        (window as { marked?: object }).marked = { use() {}, parse: () => '' };
        (window as { hljs?: object }).hljs = { highlight: () => ({ value: '' }) };
        (window as { twemoji?: object }).twemoji = {
          replace: (t: string) => t,
          convert: { toCodePoint: () => '' },
        };
        (window as { DOMPurify?: object }).DOMPurify = {
          sanitize: (s: string) => s,
          addHook() {},
          removeHook() {},
        };
        script.dispatchEvent(new Event('load'));
      });
      return HTMLElement.prototype.appendChild.call(document.head, node);
    });

    await expect(ensureMessagingLibs()).rejects.toThrow('Failed to load /js/marked.min.js');
    expect(document.head.querySelector('script[src="/js/marked.min.js"]')).toBeNull();

    await ensureMessagingLibs();
    expect(document.head.querySelectorAll('script[src="/js/marked.min.js"]')).toHaveLength(1);
  });
});

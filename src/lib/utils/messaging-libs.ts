const MESSAGING_SCRIPTS = [
  '/js/marked.min.js',
  '/js/highlight.min.js',
  '/js/twemoji.min.js',
  '/js/dompurify.min.js',
] as const;

let loadPromise: Promise<void> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          existing.remove();
          reject(new Error(`Failed to load ${src}`));
        },
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = '1';
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        reject(new Error(`Failed to load ${src}`));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
}

function messagingLibsPresent(): boolean {
  return Boolean(
    window.marked && window.hljs && window.twemoji && window.DOMPurify,
  );
}

/** Inject chat markdown/emoji/sanitize scripts once (not on cold login). */
export function ensureMessagingLibs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (messagingLibsPresent()) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = (async () => {
      for (const src of MESSAGING_SCRIPTS) {
        await injectScript(src);
      }
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

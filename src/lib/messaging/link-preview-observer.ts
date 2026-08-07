import { requestLinkPreview } from './link-preview';
import type { DmMessage } from '../../stores/dm';

export interface LinkPreviewObserverParams {
  chatId: string;
  message: DmMessage;
}

// Module-level singleton so every `Message` mount shares one IntersectionObserver instead of
// each row creating its own. `rootMargin` starts the fetch slightly before the message is
// fully on-screen (a lazy-load buffer); `threshold: 0` fires as soon as any pixel is visible.
let observer: IntersectionObserver | null = null;
const paramsByNode = new WeakMap<Element, LinkPreviewObserverParams | undefined>();
const triggered = new WeakSet<Element>();

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || triggered.has(entry.target)) continue;
          triggered.add(entry.target);
          const params = paramsByNode.get(entry.target);
          if (params) requestLinkPreview(params.chatId, params.message);
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    );
  }
  return observer;
}

/**
 * Svelte action: requests a message's link preview only once its row scrolls into view, instead
 * of eagerly on arrival/load. Fires at most once per node (unobserves after the first
 * intersection); `requestLinkPreview`'s own dedupe set still protects against re-fetching if the
 * node is re-observed for any reason.
 */
export function observeLinkPreview(
  node: HTMLElement,
  params: LinkPreviewObserverParams | undefined
): { update(newParams: LinkPreviewObserverParams | undefined): void; destroy(): void } {
  const io = ensureObserver();
  paramsByNode.set(node, params);
  io?.observe(node);

  return {
    update(newParams) {
      paramsByNode.set(node, newParams);
    },
    destroy() {
      io?.unobserve(node);
      paramsByNode.delete(node);
    },
  };
}

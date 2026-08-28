import { requestLinkPreview } from './link-preview';
import { webPreviewsEnabled } from '../../stores/web-previews';
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
/** Nodes that intersected while "Web Previews" was disabled; retried when the setting is re-enabled. */
const blockedByDisabledSetting = new Set<Element>();

/** Ask `requestLinkPreview` to settle a node: stop watching on any permanent outcome, keep
 * watching (for a later retry) if the only thing blocking it is the disabled setting. */
function settleNode(node: Element, params: LinkPreviewObserverParams): void {
  if (requestLinkPreview(params.chatId, params.message)) {
    triggered.add(node);
    blockedByDisabledSetting.delete(node);
    observer?.unobserve(node);
  } else {
    blockedByDisabledSetting.add(node);
  }
}

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || triggered.has(entry.target)) continue;
          const params = paramsByNode.get(entry.target);
          if (!params) {
            triggered.add(entry.target);
            observer?.unobserve(entry.target);
            continue;
          }
          settleNode(entry.target, params);
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    );
  }
  return observer;
}

// Without this, re-enabling the setting would leave every row that intersected while it was off
// preview-less until it scrolls fully out of view and back (a fresh intersection) or remounts.
webPreviewsEnabled.subscribe((enabled) => {
  if (!enabled || blockedByDisabledSetting.size === 0) return;
  for (const node of blockedByDisabledSetting) {
    const params = paramsByNode.get(node);
    if (params) settleNode(node, params);
    else blockedByDisabledSetting.delete(node);
  }
});

/**
 * Svelte action: requests a message's link preview only once its row scrolls into view, instead
 * of eagerly on arrival/load. Stops watching a node once its outcome is permanent (queued, or
 * the message will never get a preview); if the intersection is blocked only because the "Web
 * Previews" setting is off, keeps watching and retries automatically once the setting is
 * re-enabled. `requestLinkPreview`'s own dedupe set still protects against re-fetching if the
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
      blockedByDisabledSetting.delete(node);
    },
  };
}

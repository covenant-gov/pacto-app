/**
 * Svelte action: move the node to document.body so it renders on top of the entire app
 * (e.g. toast visible even when Settings/Profile or other views are open).
 */
export function portal(node: HTMLElement): { destroy: () => void } {
  document.body.appendChild(node);
  return {
    destroy() {
      if (node.parentNode) node.parentNode.removeChild(node);
    },
  };
}

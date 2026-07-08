import type { HatTreeNodeDto } from './api';

/** Mirrors `DEFAULT_MAX_NODES` in `src-tauri/src/evm/hats_read.rs`. */
export const HATS_TREE_DEFAULT_MAX_NODES = 48;

/** Mirrors `DEFAULT_MAX_DEPTH` in `src-tauri/src/evm/hats_read.rs`. */
export const HATS_TREE_DEFAULT_MAX_DEPTH = 6;

export function countHatTreeNodes(node: HatTreeNodeDto | null | undefined): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children ?? []) {
    count += countHatTreeNodes(child);
  }
  return count;
}

/** Heuristic until backend exposes an explicit truncated flag. */
export function isHatsTreeLikelyTruncated(
  node: HatTreeNodeDto | null | undefined,
  maxNodes = HATS_TREE_DEFAULT_MAX_NODES,
): boolean {
  return countHatTreeNodes(node) >= maxNodes;
}

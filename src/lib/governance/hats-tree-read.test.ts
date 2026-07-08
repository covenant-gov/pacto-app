import { describe, expect, it } from 'vitest';
import type { HatTreeNodeDto } from './api';
import {
  countHatTreeNodes,
  HATS_TREE_DEFAULT_MAX_NODES,
  isHatsTreeLikelyTruncated,
} from './hats-tree-read';

function hat(id: string, children: HatTreeNodeDto[] = []): HatTreeNodeDto {
  return {
    hatId: id,
    details: '',
    maxSupply: 1,
    supply: 0,
    active: true,
    children,
  };
}

describe('countHatTreeNodes', () => {
  it('counts root and descendants', () => {
    const tree = hat('1', [hat('2'), hat('3', [hat('4')])]);
    expect(countHatTreeNodes(tree)).toBe(4);
  });
});

describe('isHatsTreeLikelyTruncated', () => {
  it('is false below the BFS node cap', () => {
    const tree = hat('1', Array.from({ length: 10 }, (_, i) => hat(String(i + 2))));
    expect(countHatTreeNodes(tree)).toBe(11);
    expect(isHatsTreeLikelyTruncated(tree)).toBe(false);
  });

  it('is true when rendered node count reaches the cap', () => {
    const tree = hat('1', Array.from({ length: HATS_TREE_DEFAULT_MAX_NODES - 1 }, (_, i) => hat(String(i + 2))));
    expect(countHatTreeNodes(tree)).toBe(HATS_TREE_DEFAULT_MAX_NODES);
    expect(isHatsTreeLikelyTruncated(tree)).toBe(true);
  });
});

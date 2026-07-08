import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { portal } from './portal';

describe('portal', () => {
  let body: {
    appendChild: (node: unknown) => void;
    removeChild: (node: unknown) => void;
    contains: (node: unknown) => boolean;
  };
  let node: { parentNode: typeof body | null };

  beforeEach(() => {
    body = {
      appendChild: (_n) => {
        node.parentNode = body;
      },
      removeChild: (_n) => {
        node.parentNode = null;
      },
      contains: (_n) => node.parentNode === body,
    };
    node = { parentNode: null };
    vi.stubGlobal('document', { body });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends node to document.body', () => {
    portal(node as unknown as HTMLElement);
    expect(node.parentNode).toBe(body);
  });

  it('returns destroy that removes node from document.body', () => {
    const action = portal(node as unknown as HTMLElement);
    expect(node.parentNode).toBe(body);
    action.destroy();
    expect(node.parentNode).toBeNull();
  });
});

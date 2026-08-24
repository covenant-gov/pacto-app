import { describe, expect, it } from 'vitest';
import { hatsTreeRoleActionKind } from './hats-tree-role-actions';

describe('hatsTreeRoleActionKind', () => {
  it('maps Nave role labels to in-tree action kinds', () => {
    expect(hatsTreeRoleActionKind('Treasury Authority Role')).toBe('treasury');
    expect(hatsTreeRoleActionKind('Mutiny Role')).toBe('mutiny');
    expect(hatsTreeRoleActionKind('Quartermaster Role')).toBe('quartermaster');
  });

  it('ignores wearer and admin hats', () => {
    expect(hatsTreeRoleActionKind('Top hat')).toBeNull();
    expect(hatsTreeRoleActionKind('Captain')).toBeNull();
    expect(hatsTreeRoleActionKind('Crew')).toBeNull();
    expect(hatsTreeRoleActionKind('Squad Admin')).toBeNull();
    expect(hatsTreeRoleActionKind('')).toBeNull();
  });
});

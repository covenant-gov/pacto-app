import { describe, expect, it } from 'vitest';
import type { HatTreeNodeDto } from './api';
import {
  buildHatsTreeInfoViewModel,
  formatHatQuantity,
  HAT_SUPPLY_UNLIMITED_THRESHOLD,
  hatsTreeInfoKey,
  inferWearerKind,
} from './hats-tree-info';

function node(partial: Partial<HatTreeNodeDto> = {}): HatTreeNodeDto {
  return {
    hatId: '1',
    details: '',
    maxSupply: 1,
    supply: 1,
    active: true,
    children: [],
    ...partial,
  };
}

describe('hatsTreeInfoKey', () => {
  it('maps Nave role labels', () => {
    expect(hatsTreeInfoKey('Top hat')).toBe('topHat');
    expect(hatsTreeInfoKey('Captain')).toBe('captain');
    expect(hatsTreeInfoKey('Crew')).toBe('crew');
    expect(hatsTreeInfoKey('Mutiny Role')).toBe('mutiny');
    expect(hatsTreeInfoKey('Quartermaster Role')).toBe('quartermaster');
    expect(hatsTreeInfoKey('Treasury Authority Role')).toBe('treasuryAuthority');
    expect(hatsTreeInfoKey('Squad Admin')).toBe('squadAdmin');
  });

  it('falls back to unknown', () => {
    expect(hatsTreeInfoKey('')).toBe('unknown');
    expect(hatsTreeInfoKey('Custom Role')).toBe('unknown');
  });
});

describe('formatHatQuantity', () => {
  it('formats finite max supply', () => {
    expect(formatHatQuantity(1, 1)).toEqual({ count: 1, unlimited: false, max: 1 });
    expect(formatHatQuantity(3, 10)).toEqual({ count: 3, unlimited: false, max: 10 });
  });

  it('treats uint32 max as unlimited', () => {
    expect(formatHatQuantity(3, HAT_SUPPLY_UNLIMITED_THRESHOLD)).toEqual({
      count: 3,
      unlimited: true,
      max: 0,
    });
    expect(formatHatQuantity(0, HAT_SUPPLY_UNLIMITED_THRESHOLD + 1).unlimited).toBe(true);
  });
});

describe('inferWearerKind', () => {
  const contract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const user = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('detects protocol module as contract', () => {
    expect(
      inferWearerKind([contract], { [contract]: 'Mutiny module' }, {}),
    ).toBe('contract');
  });

  it('detects roster EOA as user', () => {
    expect(inferWearerKind([user], {}, { [user]: 'npub1abc' })).toBe('user');
  });

  it('detects mix as userOrContract', () => {
    expect(
      inferWearerKind(
        [contract, user],
        { [contract]: 'Treasury Safe' },
        { [user]: 'npub1abc' },
      ),
    ).toBe('userOrContract');
  });

  it('returns null when empty', () => {
    expect(inferWearerKind([], {}, {})).toBeNull();
  });
});

describe('buildHatsTreeInfoViewModel', () => {
  it('includes mutiny functions and omits crew functions', () => {
    const mutiny = buildHatsTreeInfoViewModel({
      node: node(),
      roleLabel: 'Mutiny Role',
    });
    expect(mutiny.functions.length).toBe(2);
    expect(mutiny.wearerKind).toBe('contract');

    const crew = buildHatsTreeInfoViewModel({
      node: node({ supply: 3, maxSupply: HAT_SUPPLY_UNLIMITED_THRESHOLD }),
      roleLabel: 'Crew',
    });
    expect(crew.functions).toEqual([]);
    expect(crew.quantity.unlimited).toBe(true);
    expect(crew.wearerKind).toBe('user');
  });

  it('prefers live wearer inference over default', () => {
    const captainAddr = '0xcccccccccccccccccccccccccccccccccccccccc';
    const vm = buildHatsTreeInfoViewModel({
      node: node(),
      roleLabel: 'Captain',
      wearerAddresses: [captainAddr],
      knownWearerLabels: { [captainAddr]: 'Treasury Safe' },
    });
    expect(vm.wearerKind).toBe('contract');
  });

  it('uses on-chain details as display name for unknown', () => {
    const vm = buildHatsTreeInfoViewModel({
      node: node({ details: 'Custom Ops' }),
      roleLabel: '',
    });
    expect(vm.infoKey).toBe('unknown');
    expect(vm.displayName).toBe('Custom Ops');
    expect(vm.functions).toEqual([]);
  });
});

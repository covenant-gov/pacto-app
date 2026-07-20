import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendDmMessage, listSquadInfra, currentUser } = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => {
          subs.delete(run);
        };
      },
      set(next: T) {
        value = next;
        for (const run of subs) run(value);
      },
      update(fn: (v: T) => T) {
        this.set(fn(value));
      },
    };
  }
  return {
    sendDmMessage: vi.fn(),
    listSquadInfra: vi.fn(),
    currentUser: makeStore<{ npub: string } | null>({ npub: 'npub1alice' }),
  };
});

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
}));

vi.mock('../governance/api', () => ({
  listSquadInfra: (...args: unknown[]) => listSquadInfra(...args),
}));

vi.mock('../../stores/auth', () => ({
  currentUser,
}));

import { saveSquadNetworkOverride, SQUAD_NETWORK_PREFIX } from './squad-network';
import {
  formatSquadNetworkUpdated,
  infraChainFromSquadRows,
  parseSquadNetworkUpdated,
  publishSquadNetworkUpdated,
  SQUAD_NETWORK_UPDATED_TYPE,
} from './squad-network-share';

describe('squad-network-share', () => {
  const npub = 'npub1alice';
  const gid = 'ann-gid';
  const store = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.set({ npub });
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    sendDmMessage.mockResolvedValue(undefined);
    listSquadInfra.mockResolvedValue([]);
  });

  it('formats and parses squad_network_updated', () => {
    const raw = formatSquadNetworkUpdated({ parentId: gid, chain: 'sepolia' });
    expect(JSON.parse(raw)).toMatchObject({
      type: SQUAD_NETWORK_UPDATED_TYPE,
      pacto_virtual_bucket: 'announcements',
      payload: { parent_id: gid, chain: 'sepolia' },
    });
    expect(parseSquadNetworkUpdated(raw)).toEqual({ parent_id: gid, chain: 'sepolia' });
  });

  it('rejects non-deployable chains on parse', () => {
    const raw = JSON.stringify({
      type: SQUAD_NETWORK_UPDATED_TYPE,
      payload: { parent_id: gid, chain: 'mainnet' },
    });
    expect(parseSquadNetworkUpdated(raw)).toBeNull();
  });

  it('infraChainFromSquadRows prefers pacto_gov then squad_admin then sponsor', () => {
    expect(
      infraChainFromSquadRows([
        { infraType: 'sponsor', chain: 'local' },
        { infraType: 'pacto_gov', chain: 'sepolia' },
      ]),
    ).toBe('sepolia');
    expect(infraChainFromSquadRows([{ infraType: 'sponsor', chain: 'local' }])).toBe('local');
  });

  it('publishes override when set', async () => {
    saveSquadNetworkOverride(npub, gid, 'local');
    await expect(publishSquadNetworkUpdated(gid)).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      gid,
      expect.stringContaining('"chain":"local"'),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(localStorage.getItem(`${SQUAD_NETWORK_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('publishes infra chain when override unset', async () => {
    listSquadInfra.mockResolvedValueOnce([
      { infraType: 'pacto_gov', chain: 'sepolia', id: '1', parentId: gid, canonicalRef: '1' },
    ]);
    await expect(publishSquadNetworkUpdated(gid)).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      gid,
      expect.stringContaining('"chain":"sepolia"'),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('returns false when network unset', async () => {
    await expect(publishSquadNetworkUpdated(gid)).resolves.toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});

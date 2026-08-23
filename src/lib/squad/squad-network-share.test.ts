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

import { saveSquadNetworkPair, SQUAD_NETWORK_PREFIX } from './squad-network';
import {
  formatSquadNetworkUpdated,
  infraChainFromSquadRows,
  parseSquadNetworkUpdated,
  practiceInfraChainFromSquadRows,
  publishSquadNetworkUpdated,
  SQUAD_NETWORK_UPDATED_TYPE,
  SQUAD_NETWORK_UPDATED_VERSION,
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

  it('formats and parses squad_network_updated v2', () => {
    const raw = formatSquadNetworkUpdated({
      parentId: gid,
      pair: { primary: 'sepolia', practice: 'local' },
    });
    expect(JSON.parse(raw)).toMatchObject({
      type: SQUAD_NETWORK_UPDATED_TYPE,
      version: SQUAD_NETWORK_UPDATED_VERSION,
      pacto_virtual_bucket: 'announcements',
      payload: { parent_id: gid, primary: 'sepolia', practice: 'local' },
    });
    expect(parseSquadNetworkUpdated(raw)).toEqual({
      parent_id: gid,
      primary: 'sepolia',
      practice: 'local',
    });
  });

  it('rejects v1 single-chain payloads', () => {
    const raw = JSON.stringify({
      type: SQUAD_NETWORK_UPDATED_TYPE,
      version: 1,
      payload: { parent_id: gid, chain: 'sepolia' },
    });
    expect(parseSquadNetworkUpdated(raw)).toBeNull();
  });

  it('rejects non-deployable chains on parse', () => {
    const raw = JSON.stringify({
      type: SQUAD_NETWORK_UPDATED_TYPE,
      version: 2,
      payload: { parent_id: gid, primary: 'mainnet', practice: 'sepolia' },
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

  it('practiceInfraChainFromSquadRows reads pacto_gov_wargame', () => {
    expect(
      practiceInfraChainFromSquadRows([
        { infraType: 'pacto_gov', chain: 'local' },
        { infraType: 'pacto_gov_wargame', chain: 'sepolia' },
      ]),
    ).toBe('sepolia');
  });

  it('publishes stored pair', async () => {
    saveSquadNetworkPair(npub, gid, { primary: 'local', practice: 'sepolia' });
    await expect(publishSquadNetworkUpdated(gid)).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      gid,
      expect.stringContaining('"primary":"local"'),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(sendDmMessage).toHaveBeenCalledWith(
      gid,
      expect.stringContaining('"practice":"sepolia"'),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(localStorage.getItem(`${SQUAD_NETWORK_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('publishes defaults when unset', async () => {
    await expect(publishSquadNetworkUpdated(gid)).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      gid,
      expect.stringContaining('"primary":"sepolia"'),
      '',
      { virtualBucket: 'announcements' },
    );
  });
});

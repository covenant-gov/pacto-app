import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  PACTO_SQUADS_PREFIX,
  hydrateSquadsFromDisk,
  squads,
  DASHBOARD_CHANNEL_ID,
} from './squads';

const NPUB = 'npub1test';

const sampleSquad = {
  id: 'squad-1',
  name: 'Alpha',
  channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
  kind: 'squad' as const,
  createdAt: 1,
  updatedAt: 1,
};

describe('hydrateSquadsFromDisk', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
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
    squads.set([]);
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    squads.set([]);
  });

  it('loads npub-scoped squads', () => {
    localStorage.setItem(`${PACTO_SQUADS_PREFIX}_${NPUB}`, JSON.stringify([sampleSquad]));
    hydrateSquadsFromDisk(NPUB);
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.name).toBe('Alpha');
  });

  it('migrates legacy pacto_squads when scoped key is missing', () => {
    localStorage.setItem(PACTO_SQUADS_PREFIX, JSON.stringify([sampleSquad]));
    hydrateSquadsFromDisk(NPUB);
    expect(get(squads)).toHaveLength(1);
    expect(localStorage.getItem(`${PACTO_SQUADS_PREFIX}_${NPUB}`)).toBeTruthy();
    expect(localStorage.getItem(PACTO_SQUADS_PREFIX)).toBeNull();
  });

  it('migrates legacy pacto_squads when scoped key is an empty array', () => {
    localStorage.setItem(`${PACTO_SQUADS_PREFIX}_${NPUB}`, '[]');
    localStorage.setItem(PACTO_SQUADS_PREFIX, JSON.stringify([sampleSquad]));
    hydrateSquadsFromDisk(NPUB);
    expect(get(squads)).toHaveLength(1);
  });

  it('backfills default hub channel rows on load', () => {
    localStorage.setItem(`${PACTO_SQUADS_PREFIX}_${NPUB}`, JSON.stringify([sampleSquad]));
    hydrateSquadsFromDisk(NPUB);
    const names = get(squads)[0]?.channels.map((c) => c.name);
    expect(names).toContain('inbox');
    expect(names).toContain('polls');
  });

  it('skips malformed rows without dropping valid squads', () => {
    localStorage.setItem(
      `${PACTO_SQUADS_PREFIX}_${NPUB}`,
      JSON.stringify([sampleSquad, { bad: true }, null])
    );
    hydrateSquadsFromDisk(NPUB);
    expect(get(squads)).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { isJoinRequesterMuted, muteJoinRequester } from './squad-join-spam';

describe('squad join mute', () => {
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
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('mutes and checks requester per squad', () => {
    expect(isJoinRequesterMuted('s1', 'npub1req')).toBe(false);
    muteJoinRequester('s1', 'npub1req');
    expect(isJoinRequesterMuted('s1', 'npub1req')).toBe(true);
    expect(isJoinRequesterMuted('s2', 'npub1req')).toBe(false);
  });
});

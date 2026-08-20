import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  MUTINY_PROCESS_TX_PREFIX,
  hydrateMutinyProcessTxFromDisk,
  ingestMutinyProcessTxFromAnnounce,
  mutinyProcessTxByParentId,
  mutinyTxExplorerUrl,
  mutinyTxHashForCard,
  recordMutinyProcessTx,
  resetMutinyProcessTxStore,
  shortTxHash,
} from './mutiny-process-tx';

const START = `0x${'aa'.repeat(32)}`;
const VOTE = `0x${'bb'.repeat(32)}`;
const NPUB = 'npub1tester';

describe('mutiny process tx persistence', () => {
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
    setCurrentNpubForPersistence(NPUB);
    resetMutinyProcessTxStore();
  });

  afterEach(() => {
    resetMutinyProcessTxStore();
    setCurrentNpubForPersistence(null);
  });

  it('records start and does not let a later ingest overwrite it', () => {
    recordMutinyProcessTx({ parentId: ' p1 ', txHash: START, isStart: true });
    ingestMutinyProcessTxFromAnnounce({
      parent_id: 'p1',
      kind: 'mutiny',
      tx_hash: VOTE,
    });
    const rec = get(mutinyProcessTxByParentId).p1;
    expect(rec).toEqual({ startTxHash: START, lastTxHash: VOTE });
    expect(mutinyTxHashForCard(get(mutinyProcessTxByParentId), 'p1')).toBe(START);
  });

  it('treats the first seen mutiny hash as start when ingest arrives first', () => {
    ingestMutinyProcessTxFromAnnounce({
      parent_id: 'p1',
      kind: 'mutiny',
      tx_hash: VOTE,
    });
    expect(get(mutinyProcessTxByParentId).p1).toEqual({
      startTxHash: VOTE,
      lastTxHash: VOTE,
    });
    ingestMutinyProcessTxFromAnnounce({
      parent_id: 'p1',
      kind: 'mutiny',
      tx_hash: START,
    });
    expect(get(mutinyProcessTxByParentId).p1.startTxHash).toBe(VOTE);
    expect(get(mutinyProcessTxByParentId).p1.lastTxHash).toBe(START);
  });

  it('overwrites start on a later local start', () => {
    recordMutinyProcessTx({ parentId: 'p1', txHash: VOTE, isStart: false });
    recordMutinyProcessTx({ parentId: 'p1', txHash: START, isStart: true });
    expect(get(mutinyProcessTxByParentId).p1.startTxHash).toBe(START);
  });

  it('ignores non-mutiny announces and invalid hashes', () => {
    ingestMutinyProcessTxFromAnnounce({
      parent_id: 'p1',
      kind: 'ta_proposal',
      tx_hash: START,
    });
    recordMutinyProcessTx({ parentId: 'p1', txHash: '0xabc', isStart: true });
    expect(get(mutinyProcessTxByParentId)).toEqual({});
  });

  it('persists and hydrates npub-scoped state', () => {
    recordMutinyProcessTx({ parentId: 'p1', txHash: START, isStart: true });
    expect(store.get(`${MUTINY_PROCESS_TX_PREFIX}_${NPUB}`)).toBeTruthy();
    resetMutinyProcessTxStore();
    expect(get(mutinyProcessTxByParentId)).toEqual({});
    hydrateMutinyProcessTxFromDisk();
    expect(mutinyTxHashForCard(get(mutinyProcessTxByParentId), 'p1')).toBe(START);
  });

  it('formats a short hash and sepolia explorer url', () => {
    expect(shortTxHash(START)).toBe('0xaaaaaaaa…aaaa');
    expect(mutinyTxExplorerUrl('sepolia', START)).toBe(
      `https://sepolia.etherscan.io/tx/${START}`,
    );
    expect(mutinyTxExplorerUrl('sepolia', 'nope')).toBeNull();
  });
});

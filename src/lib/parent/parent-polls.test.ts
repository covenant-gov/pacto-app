import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadParentPolls,
  saveParentPolls,
  addParentPoll,
  updateParentPoll,
  pollReferenceToken,
  getPollBallotMap,
  getPollBallot,
  setPollBallot,
  type ParentPoll,
} from './parent-polls';

describe('parent-polls', () => {
  const viewerNpub = 'npub1test';
  const parentId = 'parent-1';
  const store = new Map<string, string>();

  const poll: ParentPoll = {
    id: 'poll-1',
    parentId,
    title: 'T',
    description: 'D',
    options: [
      { id: 'opt-1', label: 'A', votes: 0 },
      { id: 'opt-2', label: 'B', votes: 3 },
    ],
    createdAtMs: 1000,
  };

  const poll2: ParentPoll = {
    id: 'poll-2',
    parentId,
    title: 'T2',
    description: 'D2',
    options: [{ id: 'opt-3', label: 'C', votes: 1 }],
    createdAtMs: 500,
  };

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
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('round-trips polls through localStorage', () => {
    saveParentPolls(viewerNpub, parentId, [poll, poll2]);
    const loaded = loadParentPolls(viewerNpub, parentId);
    expect(loaded).toEqual([poll2, poll]);
  });

  it('adds a poll to the stored list', () => {
    addParentPoll(viewerNpub, parentId, poll);
    addParentPoll(viewerNpub, parentId, poll2);
    expect(loadParentPolls(viewerNpub, parentId)).toEqual([poll2, poll]);
  });

  it('updates a poll by id', () => {
    saveParentPolls(viewerNpub, parentId, [poll]);
    updateParentPoll(viewerNpub, parentId, 'poll-1', (p) => ({
      ...p,
      title: 'Updated',
      options: [{ id: 'opt-1', label: 'A', votes: 10 }],
    }));
    const loaded = loadParentPolls(viewerNpub, parentId)[0];
    expect(loaded?.title).toBe('Updated');
    expect(loaded?.options).toEqual([{ id: 'opt-1', label: 'A', votes: 10 }]);
  });

  it('ignores updates when poll id is missing', () => {
    saveParentPolls(viewerNpub, parentId, [poll]);
    updateParentPoll(viewerNpub, parentId, 'missing', (p) => ({ ...p, title: 'X' }));
    expect(loadParentPolls(viewerNpub, parentId)[0]?.title).toBe('T');
  });

  it('returns a stable poll reference token', () => {
    expect(pollReferenceToken('poll-1')).toBe('dashboard-poll:poll-1');
    expect(pollReferenceToken('  poll-1  ')).toBe('dashboard-poll:poll-1');
  });

  it('returns empty array when localStorage is missing', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(loadParentPolls(viewerNpub, parentId)).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    store.set(
      `pacto_parent_polls_v1_${viewerNpub}_${parentId}`,
      'not json'
    );
    expect(loadParentPolls(viewerNpub, parentId)).toEqual([]);
  });

  it('filters invalid poll entries while keeping valid ones', () => {
    store.set(
      `pacto_parent_polls_v1_${viewerNpub}_${parentId}`,
      JSON.stringify([poll, { id: 'bad' }, null])
    );
    const loaded = loadParentPolls(viewerNpub, parentId);
    expect(loaded).toEqual([poll]);
  });

  it('returns empty array for non-array JSON', () => {
    store.set(
      `pacto_parent_polls_v1_${viewerNpub}_${parentId}`,
      JSON.stringify({ foo: 'bar' })
    );
    expect(loadParentPolls(viewerNpub, parentId)).toEqual([]);
  });

  it('ignores localStorage quota errors when saving polls', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveParentPolls(viewerNpub, parentId, [poll])).not.toThrow();
  });

  it('round-trips ballots', () => {
    setPollBallot(viewerNpub, parentId, 'poll-1', 'opt-1');
    setPollBallot(viewerNpub, parentId, 'poll-2', 'opt-3');
    expect(getPollBallot(viewerNpub, parentId, 'poll-1')).toBe('opt-1');
    expect(getPollBallot(viewerNpub, parentId, 'poll-2')).toBe('opt-3');
    expect(getPollBallotMap(viewerNpub, parentId)).toEqual({
      'poll-1': 'opt-1',
      'poll-2': 'opt-3',
    });
  });

  it('returns null for missing ballot', () => {
    expect(getPollBallot(viewerNpub, parentId, 'unknown')).toBeNull();
  });

  it('ignores ballot writes when keys are missing', () => {
    setPollBallot('', parentId, 'poll-1', 'opt-1');
    expect(getPollBallot('', parentId, 'poll-1')).toBeNull();
  });

  it('ignores malformed ballot JSON', () => {
    store.set(
      `pacto_parent_poll_ballots_v1_${viewerNpub}_${parentId}`,
      'not json'
    );
    expect(getPollBallotMap(viewerNpub, parentId)).toEqual({});
  });

  it('ignores localStorage quota errors when saving ballots', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setPollBallot(viewerNpub, parentId, 'poll-1', 'opt-1')).not.toThrow();
  });

  it('filters non-string ballot values', () => {
    store.set(
      `pacto_parent_poll_ballots_v1_${viewerNpub}_${parentId}`,
      JSON.stringify({ 'poll-1': 'opt-1', 'poll-2': 123 })
    );
    expect(getPollBallotMap(viewerNpub, parentId)).toEqual({ 'poll-1': 'opt-1' });
  });
});

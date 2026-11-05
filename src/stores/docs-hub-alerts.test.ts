import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { SquadContentPolicyView } from '../lib/api/squad-content-policy';
import type * as SquadContentPolicyApi from '../lib/api/squad-content-policy';

const mocks = vi.hoisted(() => ({ getSquadContentPolicy: vi.fn() }));
vi.mock('../lib/api/squad-content-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof SquadContentPolicyApi>()),
  getSquadContentPolicy: mocks.getSquadContentPolicy,
}));

import { currentUser } from './auth-session';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  LAST_SEEN_DOC_CARD_AT_PREFIX,
  canOfferSaveToDocs,
  countUnseenDocCards,
  docCardKey,
  ensureSquadDocAddPolicy,
  lastSeenDocCardAtMsByParentId,
  loadLastSeenDocCardAt,
  markDocsChannelSeen,
  refreshUnseenDocCardsForParent,
  reloadSquadDocAddPolicy,
  resetDocsHubAlertStores,
  squadDocAddPolicyByParentId,
  unseenDocCardCountByParentId,
  type DocCardMessageLike,
} from './docs-hub-alerts';

const ME = 'npub1me';
const OTHER = 'npub1other';
const PARENT = 'parent-1';

function docCard(id: string, at: number, npub = OTHER): DocCardMessageLike {
  return {
    at,
    npub,
    content: JSON.stringify({
      type: 'squad_doc_added',
      payload: { id, parent_id: PARENT, title: 't', provider: 'other', channel_id: null, display_url: 'https://x/' },
    }),
  };
}

/** Update and remove rumors post no card; if one ever reached the timeline it must not badge. */
function docUpdate(id: string, at: number): DocCardMessageLike {
  return {
    at,
    npub: OTHER,
    content: JSON.stringify({ schema: 'pacto.squad_doc.v1', op: 'update', id, parent_id: PARENT, updated_at_ms: at }),
  };
}

function policy(overrides: Partial<SquadContentPolicyView> = {}): SquadContentPolicyView {
  return {
    restrictEventCreate: false,
    restrictEventCreateUpdatedAtMs: 0,
    restrictDocAdd: false,
    restrictDocAddUpdatedAtMs: 0,
    callerIsAdmin: false,
    adminIsMember: true,
    ...overrides,
  };
}

describe('docCardKey', () => {
  it('keys doc-added cards and ignores everything else', () => {
    expect(docCardKey(docCard('d1', 1).content)).toBe('d1');
    expect(docCardKey(docUpdate('d1', 1).content)).toBeNull();
    expect(docCardKey('hello')).toBeNull();
    expect(docCardKey(JSON.stringify({ type: 'squad_event_created', payload: { id: 'e1' } }))).toBeNull();
  });
});

describe('countUnseenDocCards', () => {
  it('counts adds by others and skips the current npub and own messages', () => {
    const msgs = [docCard('d1', 10, ME), { ...docCard('d2', 10), mine: true }, docCard('d3', 10)];
    expect(countUnseenDocCards(msgs, 0, ME)).toBe(1);
  });

  it('ignores updates, removes, chat, and cards at or before the watermark', () => {
    const msgs: DocCardMessageLike[] = [
      docUpdate('d1', 20),
      { at: 20, npub: OTHER, content: 'plain chat' },
      docCard('old', 5),
      docCard('new', 20),
    ];
    expect(countUnseenDocCards(msgs, 5, ME)).toBe(1);
  });

  it('counts the same doc once', () => {
    expect(countUnseenDocCards([docCard('d1', 10), docCard('d1', 11)], 0, ME)).toBe(1);
  });
});

describe('docs hub alert stores', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
    resetDocsHubAlertStores();
    currentUser.set({ npub: ME, pubkey: 'pk' });
    setCurrentNpubForPersistence(ME);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    resetDocsHubAlertStores();
  });

  it('first sight sets a baseline so only later cards badge', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    refreshUnseenDocCardsForParent(PARENT, [docCard('before', 500), docCard('after', 2_000)]);
    expect(get(unseenDocCardCountByParentId)[PARENT]).toBe(1);
    expect(get(lastSeenDocCardAtMsByParentId)[PARENT]).toBe(1_000);
  });

  it('marking seen clears the badge and persists the newest card time', () => {
    lastSeenDocCardAtMsByParentId.set({ [PARENT]: 0 });
    refreshUnseenDocCardsForParent(PARENT, [docCard('d1', 400)]);
    expect(get(unseenDocCardCountByParentId)[PARENT]).toBe(1);
    markDocsChannelSeen(PARENT, [docCard('d1', 400), { at: 900, npub: OTHER, content: 'chat' }]);
    expect(get(unseenDocCardCountByParentId)[PARENT]).toBe(0);
    expect(get(lastSeenDocCardAtMsByParentId)[PARENT]).toBe(400);
    expect(JSON.parse(storage.get(`${LAST_SEEN_DOC_CARD_AT_PREFIX}_${ME}`) ?? '{}')).toEqual({ [PARENT]: 400 });
  });

  it('restores persisted watermarks', () => {
    storage.set(`${LAST_SEEN_DOC_CARD_AT_PREFIX}_${ME}`, JSON.stringify({ [PARENT]: 999, bad: 'x' }));
    loadLastSeenDocCardAt(ME);
    expect(get(lastSeenDocCardAtMsByParentId)).toEqual({ [PARENT]: 999 });
  });
});

describe('Save to Docs policy gate', () => {
  beforeEach(() => {
    resetDocsHubAlertStores();
    mocks.getSquadContentPolicy.mockReset();
  });

  it('offers the item only when the policy lets the caller add', () => {
    expect(canOfferSaveToDocs(undefined)).toBe(false);
    expect(canOfferSaveToDocs(null)).toBe(true);
    expect(canOfferSaveToDocs(policy())).toBe(true);
    expect(canOfferSaveToDocs(policy({ restrictDocAdd: true }))).toBe(false);
    expect(canOfferSaveToDocs(policy({ restrictDocAdd: true, callerIsAdmin: true }))).toBe(true);
  });

  it('loads once per parent and reloads on a policy change', async () => {
    mocks.getSquadContentPolicy.mockResolvedValueOnce(policy()).mockResolvedValueOnce(policy({ restrictDocAdd: true }));
    ensureSquadDocAddPolicy('g', PARENT, 0);
    ensureSquadDocAddPolicy('g', PARENT, 0);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toEqual(policy()));
    expect(mocks.getSquadContentPolicy).toHaveBeenCalledTimes(1);
    expect(mocks.getSquadContentPolicy).toHaveBeenCalledWith('g', PARENT);

    reloadSquadDocAddPolicy(PARENT);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]?.restrictDocAdd).toBe(true));
    reloadSquadDocAddPolicy('unknown-parent');
    expect(mocks.getSquadContentPolicy).toHaveBeenCalledTimes(2);
  });

  it('reloads when the announcements group membership version changes, e.g. an admin promotion', async () => {
    mocks.getSquadContentPolicy
      .mockResolvedValueOnce(policy({ restrictDocAdd: true }))
      .mockResolvedValueOnce(policy({ restrictDocAdd: true, callerIsAdmin: true }));
    ensureSquadDocAddPolicy('g', PARENT, 3);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]?.restrictDocAdd).toBe(true));
    expect(canOfferSaveToDocs(get(squadDocAddPolicyByParentId)[PARENT])).toBe(false);

    ensureSquadDocAddPolicy('g', PARENT, 3);
    expect(mocks.getSquadContentPolicy).toHaveBeenCalledTimes(1);

    ensureSquadDocAddPolicy('g', PARENT, 4);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]?.callerIsAdmin).toBe(true));
    expect(mocks.getSquadContentPolicy).toHaveBeenCalledTimes(2);
    expect(canOfferSaveToDocs(get(squadDocAddPolicyByParentId)[PARENT])).toBe(true);
  });

  it('stores null when the policy read fails', async () => {
    mocks.getSquadContentPolicy.mockRejectedValue(new Error('boom'));
    ensureSquadDocAddPolicy('g', PARENT, 0);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBeNull());
  });
});

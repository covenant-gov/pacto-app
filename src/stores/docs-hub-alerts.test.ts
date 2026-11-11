import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({ requireMySquadPrivilege: vi.fn() }));
vi.mock('../lib/governance/squad-privilege-enforce', () => ({
  requireMySquadPrivilege: mocks.requireMySquadPrivilege,
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

describe('Save to Docs privilege gate', () => {
  beforeEach(() => {
    resetDocsHubAlertStores();
    mocks.requireMySquadPrivilege.mockReset();
  });

  it('offers the item when allowed or when the read failed', () => {
    expect(canOfferSaveToDocs(undefined)).toBe(false);
    expect(canOfferSaveToDocs(null)).toBe(true);
    expect(canOfferSaveToDocs(true)).toBe(true);
    expect(canOfferSaveToDocs(false)).toBe(false);
  });

  it('loads once per parent and reloads when the privilege nonce changes', async () => {
    mocks.requireMySquadPrivilege
      .mockResolvedValueOnce({ ok: true, active: false, flags: null })
      .mockResolvedValueOnce({ ok: false, reason: 'denied', active: true });
    ensureSquadDocAddPolicy('g', PARENT, 0, 0);
    ensureSquadDocAddPolicy('g', PARENT, 0, 0);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBe(true));
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledTimes(1);
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledWith(PARENT, 'addDoc');

    ensureSquadDocAddPolicy('g', PARENT, 0, 1);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBe(false));
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a blank group id or a blank parent id', async () => {
    ensureSquadDocAddPolicy('', PARENT, 0);
    ensureSquadDocAddPolicy('   ', PARENT, 0);
    ensureSquadDocAddPolicy(null, PARENT, 0);
    ensureSquadDocAddPolicy(undefined, PARENT, 0);
    ensureSquadDocAddPolicy('g', '  ', 0);
    await Promise.resolve();
    expect(mocks.requireMySquadPrivilege).not.toHaveBeenCalled();
    expect(get(squadDocAddPolicyByParentId)).toEqual({});
  });

  it('keeps policies for different parents independent', async () => {
    mocks.requireMySquadPrivilege.mockResolvedValue({ ok: true, active: false, flags: null });
    ensureSquadDocAddPolicy('g', PARENT, 0, 0);
    ensureSquadDocAddPolicy('g', 'parent-2', 0, 0);
    await vi.waitFor(() => expect(mocks.requireMySquadPrivilege).toHaveBeenCalledTimes(2));
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledWith(PARENT, 'addDoc');
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledWith('parent-2', 'addDoc');
  });

  it('stores null on an rpc failure so the item stays offered', async () => {
    mocks.requireMySquadPrivilege.mockResolvedValue({ ok: false, reason: 'rpc', active: true });
    ensureSquadDocAddPolicy('g', PARENT, 0);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBeNull());
    expect(canOfferSaveToDocs(get(squadDocAddPolicyByParentId)[PARENT])).toBe(true);
  });

  it('reloads when the announcements group membership version changes', async () => {
    mocks.requireMySquadPrivilege
      .mockResolvedValueOnce({ ok: false, reason: 'denied', active: true })
      .mockResolvedValueOnce({ ok: true, active: true, flags: null });
    ensureSquadDocAddPolicy('g', PARENT, 3);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBe(false));
    expect(canOfferSaveToDocs(get(squadDocAddPolicyByParentId)[PARENT])).toBe(false);

    ensureSquadDocAddPolicy('g', PARENT, 3);
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledTimes(1);

    ensureSquadDocAddPolicy('g', PARENT, 4);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBe(true));
    expect(mocks.requireMySquadPrivilege).toHaveBeenCalledTimes(2);
    expect(canOfferSaveToDocs(get(squadDocAddPolicyByParentId)[PARENT])).toBe(true);
  });

  it('stores null when the privilege read fails', async () => {
    mocks.requireMySquadPrivilege.mockRejectedValue(new Error('boom'));
    ensureSquadDocAddPolicy('g', PARENT, 0);
    await vi.waitFor(() => expect(get(squadDocAddPolicyByParentId)[PARENT]).toBeNull());
  });
});

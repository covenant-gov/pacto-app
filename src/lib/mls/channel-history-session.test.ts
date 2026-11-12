import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/history-backfill', () => ({
  exportChannelHistory: vi.fn(),
  importChannelHistory: vi.fn(),
  listImportedHistoryIds: vi.fn(),
  sendHistoryGiftWrap: vi.fn(),
}));
vi.mock('../api/nostr', () => ({
  getMlsGroupMembers: vi.fn(),
  sendDmMessage: vi.fn(),
}));
vi.mock('../utils/dm-debug', () => ({ dmError: vi.fn(), dmLog: vi.fn() }));

import { exportChannelHistory, listImportedHistoryIds, sendHistoryGiftWrap } from '../api/history-backfill';
import { getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { currentUser } from '../../stores/auth-session';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { isHistoryBackfillFinished, isHistoryBackfillRunning } from './channel-history-backfill';
import {
  beginChannelHistoryBackfill,
  clearChannelHistorySession,
  handleIncomingHistoryRequest,
} from './channel-history-session';

const SELF = 'npub1self';
const REQUESTER = 'npub1requester';
const GROUP = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

function requestJson(requestId: string, groupId = GROUP): string {
  return JSON.stringify({
    type: 'history_request',
    version: 1,
    requestId,
    groupId,
    bucket: null,
    attempt: 1,
    designatedNpub: SELF,
  });
}

function reqId(n: number): string {
  return n.toString(16).padStart(32, '0');
}

function members(...npubs: string[]) {
  return { members: npubs, pending_welcomes: [] } as never;
}

const SAMPLE = {
  id: 'm1',
  kind: 14 as const,
  createdAt: 1_700_000_100,
  authorNpub: REQUESTER,
  content: 'hello',
  tags: [],
  referenceId: null,
};

describe('handleIncomingHistoryRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
    } as unknown as Storage);
    setCurrentNpubForPersistence(SELF);
    currentUser.set({ npub: SELF, pubkey: 'pk' });
    clearChannelHistorySession();
    vi.mocked(exportChannelHistory).mockReset().mockResolvedValue([SAMPLE]);
    vi.mocked(sendHistoryGiftWrap).mockReset().mockResolvedValue(undefined);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue(members(SELF, REQUESTER));
  });

  afterEach(() => {
    clearChannelHistorySession();
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  it('serves a fresh request from a member that arrived in the named group', async () => {
    await handleIncomingHistoryRequest(requestJson(reqId(1)), REQUESTER, GROUP, Date.now());
    expect(exportChannelHistory).toHaveBeenCalledWith(GROUP, null);
    expect(sendHistoryGiftWrap).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendHistoryGiftWrap).mock.calls[0][0]).toBe(REQUESTER);
  });

  it('ignores a request whose group differs from the group it arrived in', async () => {
    const otherGroup = 'ff'.repeat(32);
    await handleIncomingHistoryRequest(requestJson(reqId(1), otherGroup), REQUESTER, GROUP, Date.now());
    expect(exportChannelHistory).not.toHaveBeenCalled();
    expect(sendHistoryGiftWrap).not.toHaveBeenCalled();
  });

  it('ignores a request that names a DM npub as the group', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue(members());
    await handleIncomingHistoryRequest(
      requestJson(reqId(1), 'npub1victimcontact'),
      REQUESTER,
      GROUP,
      Date.now()
    );
    await handleIncomingHistoryRequest(
      requestJson(reqId(2), 'npub1victimcontact'),
      REQUESTER,
      'npub1victimcontact',
      Date.now()
    );
    expect(exportChannelHistory).not.toHaveBeenCalled();
    expect(sendHistoryGiftWrap).not.toHaveBeenCalled();
  });

  it('ignores a sender that is not a member of the group', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue(members(SELF, 'npub1someoneelse'));
    await handleIncomingHistoryRequest(requestJson(reqId(1)), REQUESTER, GROUP, Date.now());
    expect(exportChannelHistory).not.toHaveBeenCalled();
  });

  it('ignores a stale request and one with no send time', async () => {
    await handleIncomingHistoryRequest(requestJson(reqId(1)), REQUESTER, GROUP, Date.now() - 10 * 60_000);
    await handleIncomingHistoryRequest(requestJson(reqId(2)), REQUESTER, GROUP, undefined);
    expect(exportChannelHistory).not.toHaveBeenCalled();
  });

  it('answers one request per requester and group inside the cooldown', async () => {
    await handleIncomingHistoryRequest(requestJson(reqId(1)), REQUESTER, GROUP, Date.now());
    await handleIncomingHistoryRequest(requestJson(reqId(2)), REQUESTER, GROUP, Date.now());
    expect(exportChannelHistory).toHaveBeenCalledTimes(1);
  });

  it('does not answer the same request id twice', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue(members(SELF, REQUESTER, 'npub1other'));
    await handleIncomingHistoryRequest(requestJson(reqId(1)), REQUESTER, GROUP, Date.now());
    await handleIncomingHistoryRequest(requestJson(reqId(1)), 'npub1other', GROUP, Date.now());
    expect(exportChannelHistory).toHaveBeenCalledTimes(1);
  });
});

describe('beginChannelHistoryBackfill attempt accounting', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: new Map<string, string>(),
      getItem(k: string) {
        return (this as unknown as { store: Map<string, string> }).store.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        (this as unknown as { store: Map<string, string> }).store.set(k, v);
      },
    } as unknown as Storage);
    setCurrentNpubForPersistence(SELF);
    currentUser.set({ npub: SELF, pubkey: 'pk' });
    clearChannelHistorySession();
    vi.mocked(listImportedHistoryIds).mockReset().mockResolvedValue([]);
    vi.mocked(sendDmMessage).mockReset();
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue(members(SELF, REQUESTER, 'npub1zzz'));
  });

  afterEach(() => {
    clearChannelHistorySession();
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  async function settled(): Promise<void> {
    await vi.waitFor(() => expect(isHistoryBackfillRunning(GROUP)).toBe(false));
  }

  it('a failed request post stops without marking the group finished', async () => {
    vi.mocked(sendDmMessage).mockResolvedValue(false);
    beginChannelHistoryBackfill('ops', GROUP);
    await settled();
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
    expect(isHistoryBackfillFinished(GROUP)).toBe(false);
  });

  it('a roster load failure stops without marking the group finished', async () => {
    vi.mocked(getMlsGroupMembers).mockRejectedValue(new Error('offline'));
    beginChannelHistoryBackfill('ops', GROUP);
    await settled();
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(isHistoryBackfillFinished(GROUP)).toBe(false);
  });

  it('an empty candidate list marks the group finished', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue(members(SELF));
    beginChannelHistoryBackfill('ops', GROUP);
    await settled();
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(isHistoryBackfillFinished(GROUP)).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { CommonsBroadcastLocalState } from '../lib/commons/types';
import {
  commonsBroadcastModalOpen,
  commonsBroadcastModalClosedNonce,
  commonsUserHasActiveBroadcast,
  syncCommonsUserActiveBroadcast,
  openCommonsBroadcastModal,
  closeCommonsBroadcastModal,
} from './commons-ui';
import { fetchActiveUserCommonsBroadcast } from '../lib/commons/user-broadcast';

vi.mock('../lib/commons/user-broadcast', () => ({
  fetchActiveUserCommonsBroadcast: vi.fn(),
}));

describe('commons-ui', () => {
  beforeEach(() => {
    vi.mocked(fetchActiveUserCommonsBroadcast).mockReset();
  });

  afterEach(() => {
    commonsBroadcastModalOpen.set(false);
    commonsBroadcastModalClosedNonce.set(0);
    commonsUserHasActiveBroadcast.set(false);
  });

  it('has expected initial values', () => {
    expect(get(commonsBroadcastModalOpen)).toBe(false);
    expect(get(commonsBroadcastModalClosedNonce)).toBe(0);
    expect(get(commonsUserHasActiveBroadcast)).toBe(false);
  });

  it('syncs active broadcast state when npub is provided', async () => {
    vi.mocked(fetchActiveUserCommonsBroadcast).mockResolvedValue({ eventId: 'b1', subject: 'user', subjectId: 'npub1abc' } as CommonsBroadcastLocalState);
    await syncCommonsUserActiveBroadcast('npub1abc');
    expect(get(commonsUserHasActiveBroadcast)).toBe(true);
    expect(fetchActiveUserCommonsBroadcast).toHaveBeenCalledWith('npub1abc');
  });

  it('syncs inactive broadcast state when npub is provided', async () => {
    vi.mocked(fetchActiveUserCommonsBroadcast).mockResolvedValue(null);
    await syncCommonsUserActiveBroadcast('npub1abc');
    expect(get(commonsUserHasActiveBroadcast)).toBe(false);
  });

  it('sets active broadcast to false when npub is missing', async () => {
    commonsUserHasActiveBroadcast.set(true);
    await syncCommonsUserActiveBroadcast(undefined);
    expect(get(commonsUserHasActiveBroadcast)).toBe(false);
    expect(fetchActiveUserCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('opens the broadcast modal when no active broadcast', () => {
    openCommonsBroadcastModal();
    expect(get(commonsBroadcastModalOpen)).toBe(true);
  });

  it('does not open the broadcast modal when an active broadcast exists', () => {
    commonsUserHasActiveBroadcast.set(true);
    openCommonsBroadcastModal();
    expect(get(commonsBroadcastModalOpen)).toBe(false);
  });

  it('closes the modal and bumps the closed nonce', () => {
    commonsBroadcastModalOpen.set(true);
    closeCommonsBroadcastModal();
    expect(get(commonsBroadcastModalOpen)).toBe(false);
    expect(get(commonsBroadcastModalClosedNonce)).toBe(1);
  });

  it('does not bump the nonce when the modal is already closed', () => {
    closeCommonsBroadcastModal();
    expect(get(commonsBroadcastModalClosedNonce)).toBe(0);
  });
});

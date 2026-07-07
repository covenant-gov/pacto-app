import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  backendGroupMessages,
  backendGroupTimelineMessages,
  groupSendError,
  pendingMlsWelcomes,
  membershipVersionByGroupId,
  bumpMembershipVersion,
} from './mls-chat';
import { buildBackendGroupTimelineMessages } from '../lib/mls/virtual-channel-bucket';

vi.mock('../lib/mls/virtual-channel-bucket', () => ({
  buildBackendGroupTimelineMessages: vi.fn((input: Record<string, unknown[]>) => input),
}));

describe('mls-chat', () => {
  beforeEach(() => {
    vi.mocked(buildBackendGroupTimelineMessages).mockReset();
  });

  afterEach(() => {
    backendGroupMessages.set({});
    groupSendError.set(null);
    pendingMlsWelcomes.set([]);
    membershipVersionByGroupId.set({});
  });

  it('has expected initial values', () => {
    expect(get(backendGroupMessages)).toEqual({});
    expect(get(groupSendError)).toBeNull();
    expect(get(pendingMlsWelcomes)).toEqual([]);
    expect(get(membershipVersionByGroupId)).toEqual({});
  });

  it('derives timeline messages from backend group messages', () => {
    const messages = {
      group1: [
        { id: 'a', content: 'hello', at: 1, mine: false },
      ],
    };
    backendGroupMessages.set(messages);
    expect(get(backendGroupTimelineMessages)).toEqual(messages);
    expect(buildBackendGroupTimelineMessages).toHaveBeenCalledWith(
      messages,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('bumps the membership version for a group', () => {
    bumpMembershipVersion('g1');
    expect(get(membershipVersionByGroupId)).toEqual({ g1: 1 });
    bumpMembershipVersion('g1');
    expect(get(membershipVersionByGroupId)).toEqual({ g1: 2 });
    bumpMembershipVersion('g2');
    expect(get(membershipVersionByGroupId)).toEqual({ g1: 2, g2: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { shouldApplyDmOpenLoad } from './should-apply-dm-open-load';

describe('shouldApplyDmOpenLoad', () => {
  const chats = { alice: {} };

  it('applies when peer is still selected, present, and not deleting', () => {
    expect(shouldApplyDmOpenLoad('alice', 'alice', chats, new Set())).toBe(true);
  });

  it('rejects when selection moved away', () => {
    expect(shouldApplyDmOpenLoad('alice', 'bob', chats, new Set())).toBe(false);
    expect(shouldApplyDmOpenLoad('alice', null, chats, new Set())).toBe(false);
  });

  it('rejects when peer was removed from Friends', () => {
    expect(shouldApplyDmOpenLoad('alice', 'alice', {}, new Set())).toBe(false);
  });

  it('rejects while delete is in flight', () => {
    expect(shouldApplyDmOpenLoad('alice', 'alice', chats, new Set(['alice']))).toBe(false);
  });
});

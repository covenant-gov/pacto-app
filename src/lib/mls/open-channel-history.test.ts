import { describe, expect, it } from 'vitest';
import { mergeOpenChannelPage, shouldApplyChannelOpenLoad } from './open-channel-history';
import type { DmMessage } from '../../stores/dm';

function msg(id: string): DmMessage {
  return { id, content: id, at: 0, mine: false };
}

describe('mergeOpenChannelPage', () => {
  it('does not wipe a non-empty list with an empty page', () => {
    const existing = [msg('a'), msg('b')];
    expect(mergeOpenChannelPage(existing, [])).toBe(existing);
  });

  it('keeps store rows whose ids are absent from the page', () => {
    const existing = [msg('live'), msg('page-1')];
    const loaded = [msg('page-1'), msg('page-2')];
    expect(mergeOpenChannelPage(existing, loaded)).toEqual([
      msg('page-1'),
      msg('page-2'),
      msg('live'),
    ]);
  });

  it('keeps a single row for overlapping ids', () => {
    const existing = [msg('a'), msg('b')];
    const loaded = [msg('a')];
    const merged = mergeOpenChannelPage(existing, loaded);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(merged.filter((m) => m.id === 'a')).toHaveLength(1);
  });
});

describe('shouldApplyChannelOpenLoad', () => {
  it('applies when generation, group, and squads tab match', () => {
    expect(shouldApplyChannelOpenLoad(3, 3, 'g1', 'g1', 'squads')).toBe(true);
  });

  it('does not apply a stale generation', () => {
    expect(shouldApplyChannelOpenLoad(1, 2, 'g1', 'g1', 'squads')).toBe(false);
  });

  it('does not apply when a different channel is open', () => {
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g2', 'squads')).toBe(false);
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', null, 'squads')).toBe(false);
  });

  it('does not apply off the squads tab', () => {
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g1', 'dms')).toBe(false);
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g1', 'commons')).toBe(false);
  });
});

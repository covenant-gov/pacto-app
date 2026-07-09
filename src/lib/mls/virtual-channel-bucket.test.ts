import { describe, expect, it } from 'vitest';
import {
  defaultTrioSharesSingleMlsGroup,
  deriveVirtualBucketFromMessageContent,
  resolveVirtualBucketForTimelineMessage,
  resolveHubChannelNameForGroupSelection,
  groupTimelineKey,
  parseGroupTimelineKey,
  buildBackendGroupTimelineMessages,
  announceCardAllowedForTimelineBucket,
} from './virtual-channel-bucket';
import {
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
  buildAnnounceContent,
  parseAnnouncement,
} from '../announcements';

describe('deriveVirtualBucketFromMessageContent', () => {
  it('defaults plaintext to announcements', () => {
    expect(deriveVirtualBucketFromMessageContent('hello')).toBe('announcements');
  });

  it('reads pacto_virtual_bucket when valid', () => {
    expect(deriveVirtualBucketFromMessageContent(JSON.stringify({ pacto_virtual_bucket: 'inbox', x: 1 }))).toBe(
      'inbox'
    );
  });

  it('classifies dashboard poll vote wire as polls', () => {
    expect(
      deriveVirtualBucketFromMessageContent(
        JSON.stringify({
          schema: 'pacto.dashboard_poll.v1',
          action: 'vote',
          parent_id: 'p',
          poll_id: 'poll',
          option_id: 'o1',
        })
      )
    ).toBe('polls');
  });

  it('classifies announcement-shaped payloads', () => {
    const safeUpdated = buildAnnounceContent({
      type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
      payload: { squad_id: 's', safe_address: '0xabc' },
    });
    expect(deriveVirtualBucketFromMessageContent(safeUpdated)).toBe('inbox');

    const proposal = buildAnnounceContent({
      type: ANNOUNCE_TYPE_SAFE_PROPOSAL,
      payload: {
        id: '1',
        parent_id: 'p',
        to: '0x1',
        amount: '1',
        token: 'ETH',
        proposer_npub: 'np',
      },
    });
    expect(deriveVirtualBucketFromMessageContent(proposal)).toBe('inbox');

    const gov = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'gnosis_safe', canonical_ref: 'y' },
    });
    expect(deriveVirtualBucketFromMessageContent(gov)).toBe('inbox');

    const pactoGov = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'pacto_gov', canonical_ref: '3519' },
    });
    expect(deriveVirtualBucketFromMessageContent(pactoGov)).toBe('announcements');

    const pollCreated = buildAnnounceContent({
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: {
        parent_id: 'p',
        poll_id: 'poll',
        title: 'T',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    });
    expect(deriveVirtualBucketFromMessageContent(pollCreated)).toBe('announcements');

    const evmShare = buildAnnounceContent({
      type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
      payload: { parent_id: 'p', evm_address: '0xdef' },
    });
    expect(deriveVirtualBucketFromMessageContent(evmShare)).toBe('announcements');
  });

  it('treats unknown JSON as announcements', () => {
    expect(deriveVirtualBucketFromMessageContent(JSON.stringify({ foo: 'bar' }))).toBe('announcements');
  });

  it('derives join_requests from join request schemas', () => {
    expect(
      deriveVirtualBucketFromMessageContent(
        JSON.stringify({ schema: 'pacto.squad.join_request.v1', requestId: 'r1', status: 'pending' })
      )
    ).toBe('join_requests');
    expect(
      deriveVirtualBucketFromMessageContent(
        JSON.stringify({ schema: 'pacto.squad.join_request_response.v1', requestId: 'r1', status: 'accepted' })
      )
    ).toBe('join_requests');
  });

  it('derives squad bot meta and rotate prompt buckets', () => {
    expect(
      deriveVirtualBucketFromMessageContent(
        JSON.stringify({ schema: 'pacto.squad_bot.meta.v1', botNpub: 'npub1x', keyEpoch: 1 })
      )
    ).toBe('announcements');
    expect(
      deriveVirtualBucketFromMessageContent(
        JSON.stringify({ schema: 'pacto.squad_bot.rotate_prompt.v1', reason: 'holder_removed' })
      )
    ).toBe('inbox');
  });
});

describe('resolveVirtualBucketForTimelineMessage', () => {
  it('routes poll created to announcements even when persisted bucket is polls', () => {
    const content = buildAnnounceContent({
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: {
        parent_id: 'p',
        poll_id: 'poll',
        title: 'T',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    });
    expect(
      resolveVirtualBucketForTimelineMessage({ content, virtual_bucket: 'polls' })
    ).toBe('announcements');
  });
});

describe('defaultTrioSharesSingleMlsGroup', () => {
  it('is false when groups differ', () => {
    expect(
      defaultTrioSharesSingleMlsGroup([
        { name: 'announcements', groupId: 'a', order: 0 },
        { name: 'personal-alerts', groupId: 'b', order: 1 },
        { name: 'polls', groupId: 'c', order: 2 },
      ])
    ).toBe(false);
  });

  it('is true when default trio shares one group id', () => {
    expect(
      defaultTrioSharesSingleMlsGroup([
        { name: 'announcements', groupId: 'g', order: 0 },
        { name: 'personal-alerts', groupId: 'g', order: 1 },
        { name: 'polls', groupId: 'g', order: 2 },
      ])
    ).toBe(true);
  });
});

describe('resolveHubChannelNameForGroupSelection', () => {
  const channels = [
    { name: 'announcements', groupId: 'g', order: 0 },
    { name: 'personal-alerts', groupId: 'g', order: 1 },
    { name: 'polls', groupId: 'g', order: 2 },
  ];

  it('returns the only name when unique', () => {
    expect(resolveHubChannelNameForGroupSelection([{ name: 'x', groupId: 'z', order: 0 }], 'z', null)).toBe('x');
  });

  it('respects preferred name among duplicates', () => {
    expect(resolveHubChannelNameForGroupSelection(channels, 'g', 'polls')).toBe('polls');
  });

  it('falls back to lowest order when preference invalid', () => {
    expect(resolveHubChannelNameForGroupSelection(channels, 'g', 'nope')).toBe('announcements');
  });
});

describe('groupTimelineKey / buildBackendGroupTimelineMessages', () => {
  it('roundtrips parseGroupTimelineKey', () => {
    const k = groupTimelineKey('abc123', 'polls');
    expect(parseGroupTimelineKey(k)).toEqual({ parentGroupId: 'abc123', bucket: 'polls' });
    expect(parseGroupTimelineKey('no-separator-here')).toBe(null);
  });

  it('splits one MLS timeline into composite buckets preserving object identity', () => {
    const parent = 'mlsG';
    const m0 = { at: 2, content: 'hey' };
    const m1 = { at: 1, content: JSON.stringify({ pacto_virtual_bucket: 'inbox' }) };
    const idx = buildBackendGroupTimelineMessages({ [parent]: [m0, m1] });
    expect(idx[groupTimelineKey(parent, 'announcements')]).toEqual([m0]);
    expect(idx[groupTimelineKey(parent, 'inbox')]).toEqual([m1]);
    expect(idx[groupTimelineKey(parent, 'announcements')][0]).toBe(m0);
  });

  it('prefers SQLite-backed virtual_bucket for partitioning', () => {
    const parent = 'g';
    const idx = buildBackendGroupTimelineMessages({
      [parent]: [{ at: 1, content: 'hey', virtual_bucket: 'inbox' }],
    });
    expect(idx[groupTimelineKey(parent, 'announcements')]).toBeUndefined();
    expect(idx[groupTimelineKey(parent, 'inbox')]).toHaveLength(1);
  });

  it('sorts by at within each bucket', () => {
    const parent = 'p';
    const b = { at: 10, content: 'slow' };
    const a = { at: 3, content: 'fast' };
    const idx = buildBackendGroupTimelineMessages({ [parent]: [b, a] });
    expect(idx[groupTimelineKey(parent, 'announcements')]).toEqual([a, b]);
  });

  it('matches filter semantics for a selected bucket', () => {
    const parent = 'g';
    const msgs = [
      { at: 1, content: '{}' },
      { at: 2, content: JSON.stringify({ pacto_virtual_bucket: 'polls' }) },
      { at: 3, content: 'plain' },
    ];
    const idx = buildBackendGroupTimelineMessages({ [parent]: msgs });
    const pollsSlice = idx[groupTimelineKey(parent, 'polls')] ?? [];
    expect(pollsSlice).toEqual(msgs.filter((m) => deriveVirtualBucketFromMessageContent(m.content) === 'polls'));
  });

  it('partitions large merged timelines without dropping messages', () => {
    const parent = 'p'.repeat(40);
    const n = 8000;
    const msgs = Array.from({ length: n }, (_, i) => ({
      at: i,
      content: i % 40 === 0 ? JSON.stringify({ pacto_virtual_bucket: 'polls' }) : `plain-${i}`,
    }));
    const idx = buildBackendGroupTimelineMessages({ [parent]: msgs });
    const announcements = idx[groupTimelineKey(parent, 'announcements')] ?? [];
    const polls = idx[groupTimelineKey(parent, 'polls')] ?? [];
    expect(announcements.length + polls.length).toBe(n);
    expect(polls.length).toBe(Math.ceil(n / 40));
  });
});

describe('announceCardAllowedForTimelineBucket', () => {
  const govContent = buildAnnounceContent({
    type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
    payload: {
      parent_id: 'p',
      provider: 'gnosis_safe',
      canonical_ref: '0x1',
    },
  });
  const govParsed = parseAnnouncement(govContent);
  const pollCreated = parseAnnouncement(
    buildAnnounceContent({
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: {
        parent_id: 'p',
        poll_id: 'poll',
        title: 'T',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    })
  );

  it('allows inbox automation cards only when timeline bucket is inbox', () => {
    expect(govParsed).not.toBeNull();
    if (!govParsed) return;
    expect(
      announceCardAllowedForTimelineBucket(govParsed, { content: govContent, virtual_bucket: 'inbox' })
    ).toBe(true);
    expect(
      announceCardAllowedForTimelineBucket(govParsed, { content: govContent, virtual_bucket: 'announcements' })
    ).toBe(false);
  });

  it('allows pacto_gov governance in announcements', () => {
    const content = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'pacto_gov', canonical_ref: '3519' },
    });
    const parsed = parseAnnouncement(content);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(
      announceCardAllowedForTimelineBucket(parsed, {
        content,
        virtual_bucket: 'announcements',
      })
    ).toBe(true);
    expect(deriveVirtualBucketFromMessageContent(content)).toBe('announcements');
  });

  it('allows squad sponsor governance in announcements', () => {
    const sponsorContent = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'sponsor', canonical_ref: '0x1' },
    });
    const sponsorParsed = parseAnnouncement(sponsorContent);
    expect(sponsorParsed).not.toBeNull();
    if (!sponsorParsed) return;
    expect(
      announceCardAllowedForTimelineBucket(sponsorParsed, {
        content: sponsorContent,
        virtual_bucket: 'announcements',
      })
    ).toBe(true);
    expect(deriveVirtualBucketFromMessageContent(sponsorContent)).toBe('announcements');
  });

  it('does not gate dashboard poll created cards', () => {
    expect(pollCreated).not.toBeNull();
    if (!pollCreated) return;
    expect(
      announceCardAllowedForTimelineBucket(pollCreated, { content: 'x', virtual_bucket: 'announcements' })
    ).toBe(true);
  });

  it('routes squad_member_evm_share to announcements', () => {
    const raw = buildAnnounceContent({
      type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
      payload: { parent_id: 'p', evm_address: '0x0000000000000000000000000000000000000001' },
    });
    const p = parseAnnouncement(raw);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(deriveVirtualBucketFromMessageContent(raw)).toBe('announcements');
    expect(
      announceCardAllowedForTimelineBucket(p, { content: raw, virtual_bucket: 'announcements' })
    ).toBe(true);
    expect(
      resolveVirtualBucketForTimelineMessage({ content: raw, virtual_bucket: 'inbox' })
    ).toBe('announcements');
  });
});

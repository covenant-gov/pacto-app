import { describe, expect, it } from 'vitest';
import { parseSquadBotAnnounceMessage, shortNpub } from './squad-bot-announce';

describe('parseSquadBotAnnounceMessage', () => {
  it('parses squad bot meta for announcements timeline', () => {
    const raw = JSON.stringify({
      schema: 'pacto.squad_bot.meta.v1',
      pacto_virtual_bucket: 'announcements',
      squadId: '6225ff3ee018ef617b5167737250da0e34cfc79328061d4eae289f1b3605d090',
      botNpub: 'npub1328t8fz60tmg5yg3pa8uwes5vcczwgs3t5utwxflagpgag5965ms7r0ulm',
      holders: ['npub1j5z8n8wndsd65yjfalelcl4nt0grkd5vrawcp3p2glvr2sa8p24sln3lys'],
      keyEpoch: 1,
      updatedAt: 1783634179,
    });
    const parsed = parseSquadBotAnnounceMessage(raw);
    expect(parsed?.kind).toBe('meta');
    if (parsed?.kind !== 'meta') return;
    expect(parsed.payload.holders).toHaveLength(1);
    expect(parsed.payload.keyEpoch).toBe(1);
  });

  it('parses squad bot key rotated notice', () => {
    const raw = JSON.stringify({
      schema: 'pacto.squad_bot.key_rotated.v1',
      squadId: 's1',
      botNpub: 'npub1bot',
      keyEpoch: 2,
      rotatedByNpub: 'npub1a',
      updatedAt: 1710000000,
    });
    const parsed = parseSquadBotAnnounceMessage(raw);
    expect(parsed?.kind).toBe('key_rotated');
    if (parsed?.kind !== 'key_rotated') return;
    expect(parsed.payload.rotatedByNpub).toBe('npub1a');
  });

  it('accepts snake_case fields and string epochs', () => {
    const meta = parseSquadBotAnnounceMessage(
      JSON.stringify({
        schema: 'pacto.squad_bot.meta.v1',
        squad_id: 's1',
        bot_npub: 'npub1bot',
        holders: [' npub1a ', '', 3],
        key_epoch: '4',
        updated_at: '5',
      }),
    );
    expect(meta).toEqual({
      kind: 'meta',
      payload: {
        squadId: 's1',
        botNpub: 'npub1bot',
        holders: ['npub1a'],
        keyEpoch: 4,
        updatedAt: 5,
      },
    });

    const rotated = parseSquadBotAnnounceMessage(
      JSON.stringify({
        schema: 'pacto.squad_bot.key_rotated.v1',
        squad_id: 's1',
        bot_npub: 'npub1bot',
        key_epoch: 2,
        rotated_by_npub: 'npub1a',
        updated_at: 9,
      }),
    );
    expect(rotated?.kind).toBe('key_rotated');
  });

  it('returns null for invalid envelopes and incomplete payloads', () => {
    expect(parseSquadBotAnnounceMessage('{"type":"governance_updated","payload":{}}')).toBeNull();
    expect(parseSquadBotAnnounceMessage('hello')).toBeNull();
    expect(parseSquadBotAnnounceMessage('{')).toBeNull();
    expect(parseSquadBotAnnounceMessage('null')).toBeNull();
    expect(
      parseSquadBotAnnounceMessage(
        JSON.stringify({
          schema: 'pacto.squad_bot.meta.v1',
          squadId: 's1',
          botNpub: 'npub1bot',
          holders: 'nope',
          keyEpoch: 1,
          updatedAt: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadBotAnnounceMessage(
        JSON.stringify({
          schema: 'pacto.squad_bot.key_rotated.v1',
          squadId: 's1',
          botNpub: 'npub1bot',
          keyEpoch: 1,
          updatedAt: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadBotAnnounceMessage(
        JSON.stringify({
          schema: 'pacto.squad_bot.meta.v1',
          squadId: '  ',
          botNpub: 'npub1bot',
          holders: [],
          keyEpoch: 1,
          updatedAt: 1,
        }),
      ),
    ).toBeNull();
  });
});

describe('shortNpub', () => {
  it('shortens long npubs and leaves short ones alone', () => {
    expect(shortNpub('npub1short')).toBe('npub1short');
    expect(shortNpub('npub1abcdefghijklmnop')).toMatch(/…/);
  });
});

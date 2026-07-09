import { describe, expect, it } from 'vitest';
import { parseSquadBotAnnounceMessage } from './squad-bot-announce';

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

  it('returns null for unrelated JSON', () => {
    expect(parseSquadBotAnnounceMessage('{"type":"governance_updated","payload":{}}')).toBeNull();
    expect(parseSquadBotAnnounceMessage('hello')).toBeNull();
  });
});

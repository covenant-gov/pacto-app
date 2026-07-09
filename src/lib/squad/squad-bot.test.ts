import { describe, expect, it } from 'vitest';
import { canAddBotHolder, SQUAD_BOT_META_SCHEMA } from './squad-bot';

describe('canAddBotHolder', () => {
  const members = ['npub1a', 'npub1b', 'npub1c'];
  const holders = ['npub1a'];

  it('allows holder to add another member', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1b', holders)).toBeNull();
  });

  it('rejects non-holder actor', () => {
    expect(canAddBotHolder(members, 'npub1b', 'npub1c', holders)).toMatch(/key holders/i);
  });

  it('rejects non-member target', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1z', holders)).toMatch(/not a current/i);
  });

  it('rejects duplicate holder', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1a', holders)).toMatch(/Already/i);
  });
});

describe('squad bot schema constants', () => {
  it('matches wire doc', () => {
    expect(SQUAD_BOT_META_SCHEMA).toBe('pacto.squad_bot.meta.v1');
  });
});

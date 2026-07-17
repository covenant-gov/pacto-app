import { describe, expect, it } from 'vitest';
import { resolveSquadSponsorVariant } from './squad-sponsor-variant';

describe('resolveSquadSponsorVariant', () => {
  it('prefers the top-level variant over the payload', () => {
    expect(
      resolveSquadSponsorVariant({ variant: 'ext', providerPayload: '{"variant":"sponsor"}' }),
    ).toBe('ext');
    expect(
      resolveSquadSponsorVariant({ variant: 'hats', providerPayload: '{"variant":"ext"}' }),
    ).toBe('hats');
  });

  it('maps the persisted on-chain payload label "sponsor" to the hats variant', () => {
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"sponsor"}' })).toBe('hats');
  });

  it('normalizes case and surrounding whitespace on the payload label', () => {
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":" Sponsor "}' })).toBe(
      'hats',
    );
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":" EXT "}' })).toBe('ext');
  });

  it('resolves ext and hats payload variants through the shared helper', () => {
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"ext"}' })).toBe('ext');
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"hats"}' })).toBe('hats');
  });

  it('returns null for degenerate on-chain labels and unrecognized values', () => {
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"none"}' })).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"unknown"}' })).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":"nope"}' })).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: '{"variant":3}' })).toBeNull();
  });

  it('returns null for missing or unparseable payloads', () => {
    expect(resolveSquadSponsorVariant(null)).toBeNull();
    expect(resolveSquadSponsorVariant(undefined)).toBeNull();
    expect(resolveSquadSponsorVariant({})).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: '' })).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: 'not json' })).toBeNull();
    expect(resolveSquadSponsorVariant({ providerPayload: '42' })).toBeNull();
  });
});

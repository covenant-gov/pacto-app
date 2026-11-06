import { describe, expect, it } from 'vitest';
import {
  feeUsageActionLabel,
  truncateNpub,
} from './sponsored-fee-usage-display';

describe('sponsored-fee-usage-display', () => {
  it('feeUsageActionLabel prefers action over selector', () => {
    expect(feeUsageActionLabel({ action: 'castVote', selector: '0x12345678' })).toBe('castVote');
    expect(feeUsageActionLabel({ action: '  ', selector: '0xabcdef01' })).toBe('0xabcdef01');
    expect(feeUsageActionLabel({ action: '', selector: '' })).toBe('');
  });

  it('feeUsageActionLabel names selectors already stored as the action', () => {
    expect(feeUsageActionLabel({ action: '0x4088bd34', selector: '0x4088bd34' })).toBe(
      'createWarGameSponsor',
    );
    expect(feeUsageActionLabel({ action: '0xe5caf266', selector: '0xe5caf266' })).toBe(
      'deployNavePirata',
    );
    expect(feeUsageActionLabel({ action: '0xE5CAF266', selector: '0xe5caf266' })).toBe(
      'deployNavePirata',
    );
    expect(feeUsageActionLabel({ action: '', selector: '0x7373315f' })).toBe('expireMutiny');
  });

  it('truncateNpub shortens long npubs', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    expect(truncateNpub(npub)).toMatch(/^npub1qqqqq…/);
    expect(truncateNpub('npub1short')).toBe('npub1short');
  });
});

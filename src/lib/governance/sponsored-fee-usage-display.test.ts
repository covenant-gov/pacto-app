import { describe, expect, it } from 'vitest';
import {
  feeUsageActionLabel,
  feeUsageAmountEth,
  truncateNpub,
} from './sponsored-fee-usage-display';

describe('sponsored-fee-usage-display', () => {
  it('feeUsageActionLabel prefers action over selector', () => {
    expect(feeUsageActionLabel({ action: 'castVote', selector: '0x12345678' })).toBe('castVote');
    expect(feeUsageActionLabel({ action: '  ', selector: '0xabcdef01' })).toBe('0xabcdef01');
    expect(feeUsageActionLabel({ action: '', selector: '' })).toBe('');
  });

  it('feeUsageAmountEth formats wei and rejects junk', () => {
    expect(feeUsageAmountEth('1000000000000000')).toBe('0.001');
    expect(feeUsageAmountEth('0')).toBe('0');
    expect(feeUsageAmountEth('not-a-number')).toBeNull();
  });

  it('truncateNpub shortens long npubs', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    expect(truncateNpub(npub)).toMatch(/^npub1qqqqq…/);
    expect(truncateNpub('npub1short')).toBe('npub1short');
  });
});

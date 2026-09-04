import { describe, expect, it } from 'vitest';
import {
  assertCatalogPolicyVersion,
  bookPolicyVersion,
  getPactoAction,
  PACTO_ACTIONS,
  PACTO_ACTIONS_POLICY_VERSION,
} from './pacto_actions';

describe('pacto_actions', () => {
  it('pins catalog policyVersion to the Sepolia address book', () => {
    expect(PACTO_ACTIONS_POLICY_VERSION).toBe(3);
    expect(bookPolicyVersion('sepolia')).toBe(PACTO_ACTIONS_POLICY_VERSION);
  });

  it('maps claim to bootstrap and rotation to member', () => {
    expect(getPactoAction('claimUsername').lane).toBe('bootstrap');
    expect(getPactoAction('claimUsername').selector).toBe('0x9824550d');
    expect(getPactoAction('initiateAddressTransfer').lane).toBe('member');
    expect(getPactoAction('claimAddressTransfer').lane).toBe('member');
    expect(getPactoAction('cancelAddressTransfer').lane).toBe('member');
    expect(getPactoAction('initiateAddressTransfer').selector).toBe('0xa4df29b5');
    expect(getPactoAction('claimAddressTransfer').selector).toBe('0xbf010955');
    expect(getPactoAction('cancelAddressTransfer').selector).toBe('0xd88208dc');
  });

  it('does not register claim as a member action', () => {
    const memberClaim = PACTO_ACTIONS.filter(
      (a) => a.id === 'claimUsername' && a.lane === 'member',
    );
    expect(memberClaim).toHaveLength(0);
  });

  it('assertCatalogPolicyVersion allows equal or newer local catalog', () => {
    expect(() => assertCatalogPolicyVersion(3)).not.toThrow();
    expect(() => assertCatalogPolicyVersion(2)).not.toThrow();
    expect(() => assertCatalogPolicyVersion(3n)).not.toThrow();
  });

  it('assertCatalogPolicyVersion fails when local catalog is behind', () => {
    expect(() => assertCatalogPolicyVersion(4)).toThrowError(/behind on-chain 4/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertCatalogPolicyVersion,
  bookPolicyVersion,
  factoryTargetAddress,
  getPactoAction,
  getPactoFactoryAction,
  PACTO_ACTIONS,
  PACTO_ACTIONS_POLICY_VERSION,
  PACTO_FACTORY_ACTIONS,
  PACTO_USERNAME_ACTIONS,
} from './pacto_actions';

describe('pacto_actions', () => {
  it('pins catalog policyVersion to the Sepolia address book', () => {
    expect(PACTO_ACTIONS_POLICY_VERSION).toBe(4);
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
    const memberClaim = PACTO_USERNAME_ACTIONS.filter(
      (a) => a.id === 'claimUsername' && a.lane === 'member',
    );
    expect(memberClaim).toHaveLength(0);
  });

  it('registers factory deploy selectors on the correct book targets', () => {
    expect(getPactoFactoryAction('deployNavePirata')).toEqual({
      id: 'deployNavePirata',
      targetKey: 'navePirataFactory',
      selector: '0xe5caf266',
      lane: 'factory',
    });
    expect(getPactoFactoryAction('createSquadSponsorExt').selector).toBe('0x732ce718');
    expect(getPactoFactoryAction('createWarGameSponsor').targetKey).toBe('squadSponsorFactory');
    expect(getPactoFactoryAction('createSafeProxy').targetKey).toBe('safeProxyFactory');
    expect(PACTO_FACTORY_ACTIONS.every((a) => a.lane === 'factory')).toBe(true);
  });

  it('resolves factory targets from the Sepolia address book', () => {
    expect(factoryTargetAddress('navePirataFactory')).toBe(
      '0xd540B03A83d3Fc78922cAb9742e67B8B272bC2b9',
    );
    expect(factoryTargetAddress('squadSponsorFactory')).toBe(
      '0x9F6b1936e1817A074033591bb55DC65CBB29e4d7',
    );
    expect(factoryTargetAddress('safeProxyFactory')).toBe(
      '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    );
  });

  it('keeps PACTO_ACTIONS as an alias for username actions', () => {
    expect(PACTO_ACTIONS).toBe(PACTO_USERNAME_ACTIONS);
  });

  it('assertCatalogPolicyVersion allows equal or newer local catalog', () => {
    expect(() => assertCatalogPolicyVersion(4)).not.toThrow();
    expect(() => assertCatalogPolicyVersion(3)).not.toThrow();
    expect(() => assertCatalogPolicyVersion(2)).not.toThrow();
    expect(() => assertCatalogPolicyVersion(4n)).not.toThrow();
  });

  it('assertCatalogPolicyVersion fails when local catalog is behind', () => {
    expect(() => assertCatalogPolicyVersion(5)).toThrowError(/behind on-chain 5/);
  });
});

import { describe, expect, it } from 'vitest';
import { pactoProtocolNetworkBook } from '../pacto-protocol-addresses';
import {
  factoryTargetAddress,
  getPactoAction,
  getPactoFactoryAction,
  PACTO_ACTIONS,
  PACTO_FACTORY_ACTIONS,
  PACTO_USERNAME_ACTIONS,
} from './pacto_actions';

describe('pacto_actions', () => {
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
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(factoryTargetAddress('navePirataFactory')).toBe(
      sepolia?.pactoGov?.navePirataFactory,
    );
    expect(factoryTargetAddress('squadSponsorFactory')).toBe(sepolia?.squadSponsor?.factory);
    expect(factoryTargetAddress('safeProxyFactory')).toBe(sepolia?.safe?.proxyFactory);
  });

  it('keeps PACTO_ACTIONS as an alias for username actions', () => {
    expect(PACTO_ACTIONS).toBe(PACTO_USERNAME_ACTIONS);
  });
});

import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0x9F6b1936e1817A074033591bb55DC65CBB29e4d7');
    expect(sepolia?.squadSponsor?.paymaster).toBe('0xD84337C18dB089DF78c69Ea0df619bD48EEBBcC3');
    expect(sepolia?.erc4337?.accountImplementation).toBe(
      '0x2E9156deE65d7946305C334824e2648Ff9128f45',
    );
    expect(sepolia?.squadSponsor?.navePirataRegistry).toBe(
      '0xf6747bE3425139FCe92B67fA482331D7435bd483',
    );
    expect(sepolia?.pactoGov?.navePirataFactory).toBe('0xba54955cF9eab7F546c3a1c1fCE2584996626ef0');
    expect(sepolia?.pactoGov?.navePirataRegistry).toBe(
      '0xf6747bE3425139FCe92B67fA482331D7435bd483',
    );
    expect(sepolia?.pactoGov?.warGameRegistry).toBe('0xE415A9290964ce40f58c6f1B15183cAE565471e7');
  });

  it('exposes the book version', () => {
    expect(pactoProtocolBookVersion()).toBe(1);
  });

  it('returns undefined for an unknown network', () => {
    expect(pactoProtocolNetworkBook('mainnet')).toBeUndefined();
    expect(pactoProtocolNetworkBook('unknown' as never)).toBeUndefined();
  });

  it('exposes all Safe infrastructure addresses on Sepolia', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.safe?.proxyFactory).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(sepolia?.safe?.singleton).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(sepolia?.safe?.fallbackHandler).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('exposes PactoGov addresses on Sepolia', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.pactoGov?.masterQuartermaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(sepolia?.pactoGov?.masterMutiny).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('exposes Sepolia globalUsernameSponsor pins', () => {
    const g = pactoProtocolNetworkBook('sepolia')?.globalUsernameSponsor;
    expect(g?.protocolRegistry).toBe('0xAF61198bf3b9D8d49FA82888121c187720D6Cfe8');
    expect(g?.pactoUsernameNft).toBe('0x09e08dB9B4275979Bb2aE8C86f3bB5d406c120d1');
    expect(g?.pactoGlobalPaymaster).toBe('0x04Fc205adA4c0c5C5024546E87972C4c4bB30D0F');
    expect(g?.nostrClaimLink).toBe('0xCc0de30d2926995FB6458De7808E41E2a17B0e29');
    expect(g?.bootstrapMintPool).toBe('0x95d3B8B97C4ff48af010191E80CcAA9F55749A2B');
    expect(g?.sponsorPolicyRegistry).toBe('0xd479edB2cfE051310553716d8628c92C81cBD0db');
    expect(g?.policyVersion).toBe(3);
    expect(g?.entryPoint).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    expect(g?.allowed7702Implementation).toBe(
      '0x2E9156deE65d7946305C334824e2648Ff9128f45',
    );
  });
});

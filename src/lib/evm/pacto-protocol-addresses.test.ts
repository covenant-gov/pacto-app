import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0xD8bdc2e5Ca92e129E84207380076c1F18AA3aA95');
    expect(sepolia?.squadSponsor?.paymaster).toBe('0xc7c3Ea95734CcCa62C7FFf4d12Be2B5b8cC92BA1');
    expect(sepolia?.erc4337?.accountImplementation).toBe(
      '0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60',
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
    expect(g?.pactoUsernameNft).toBe('0xa604Eb5Df00F23f12321c9eeBa0e92e9Ca4491f2');
    expect(g?.pactoGlobalPaymaster).toBe('0x1C2eb4Ac1cD57aF67ad8B20838A28FB23d39d5b8');
    expect(g?.nostrClaimLink).toBe('0xCc0de30d2926995FB6458De7808E41E2a17B0e29');
    expect(g?.bootstrapMintPool).toBe('0x8187d8209307b73731A767B58487D302dB61f13f');
    expect(g?.policyVersion).toBe(3);
    expect(g?.entryPoint).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    expect(g?.allowed7702Implementation).toBe(
      '0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60',
    );
  });
});

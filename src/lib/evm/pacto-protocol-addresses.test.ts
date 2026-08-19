import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0xb758DB170C6D8da5AEDe32764d099AB1e496873B');
    expect(sepolia?.squadSponsor?.paymaster).toBe('0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A');
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
});

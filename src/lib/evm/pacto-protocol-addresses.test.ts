import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0x12883924e71Df814ff1E198E5C16CEFd251BC308');
    expect(sepolia?.squadSponsor?.paymaster).toBe('0x065dA13369604291E628DD8022E0e504dc62Da12');
    expect(sepolia?.erc4337?.accountImplementation).toBe(
      '0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60',
    );
    expect(sepolia?.squadSponsor?.navePirataRegistry).toBe(
      '0x50F7759F65b1a25B1a827D6c97A5dD61f0036278',
    );
    expect(sepolia?.pactoGov?.navePirataFactory).toBe('0x6E835c103F4719Fd84EAB57d256132007310B230');
    expect(sepolia?.pactoGov?.navePirataRegistry).toBe(
      '0x50F7759F65b1a25B1a827D6c97A5dD61f0036278',
    );
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

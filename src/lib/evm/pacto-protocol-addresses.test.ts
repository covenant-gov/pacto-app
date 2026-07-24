import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0x05F0130889dC678304D11cCA71983edB220A4c74');
    expect(sepolia?.squadSponsor?.paymaster).toBe('0x19B48Cb37066d47E388F2e4705c4027e5FaC8Af6');
    expect(sepolia?.pactoGov?.navePirataFactory).toBe('0x44E42cf7b2DadDe6D5fc27B57625EaF3e3D41316');
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

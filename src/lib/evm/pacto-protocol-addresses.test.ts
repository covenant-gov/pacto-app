import { describe, expect, it } from 'vitest';
import {
  pactoProtocolNetworkBook,
  pactoProtocolBookVersion,
} from './pacto-protocol-addresses';

const ADDR = /^0x[a-fA-F0-9]{40}$/;

function expectAddr(value: string | undefined) {
  expect(value).toMatch(ADDR);
}

describe('pacto-protocol-addresses', () => {
  it('loads a complete Sepolia book without pinning live hex', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expectAddr(sepolia?.squadSponsor?.factory);
    expectAddr(sepolia?.squadSponsor?.paymaster);
    expectAddr(sepolia?.squadSponsor?.entryPoint);
    expectAddr(sepolia?.pactoGov?.navePirataFactory);
    expectAddr(sepolia?.pactoGov?.warGameRegistry);
    expectAddr(sepolia?.pactoGov?.masterQuartermaster);
    expectAddr(sepolia?.pactoGov?.masterMutiny);
    expectAddr(sepolia?.erc4337?.accountImplementation);
    expect(sepolia?.squadSponsor?.navePirataRegistry).toBe(
      sepolia?.pactoGov?.navePirataRegistry,
    );
    expect(sepolia?.erc4337?.accountImplementation).toBe(
      sepolia?.globalUsernameSponsor?.allowed7702Implementation,
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
    expectAddr(sepolia?.safe?.proxyFactory);
    expectAddr(sepolia?.safe?.singleton);
    expectAddr(sepolia?.safe?.fallbackHandler);
  });

  it('exposes Sepolia globalUsernameSponsor pins', () => {
    const g = pactoProtocolNetworkBook('sepolia')?.globalUsernameSponsor;
    expectAddr(g?.protocolRegistry);
    expectAddr(g?.usernameSystemFactory);
    expectAddr(g?.pactoUsernameNft);
    expectAddr(g?.globalSponsorPool);
    expectAddr(g?.bootstrapMintPool);
    expectAddr(g?.sponsorPolicyRegistry);
    expectAddr(g?.bootstrapClaimPolicy);
    expectAddr(g?.pactoGlobalPaymaster);
    expectAddr(g?.nostrClaimLink);
    expectAddr(g?.allowed7702Implementation);
    expectAddr(g?.entryPoint);
  });
});

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

  it('does not keep retired September or Oct 2026 archive Sepolia pins', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.pactoGov?.navePirataFactory?.toLowerCase()).not.toBe(
      '0xd540b03a83d3fc78922cab9742e67b8b272bc2b9',
    );
    expect(sepolia?.pactoGov?.navePirataFactory?.toLowerCase()).not.toBe(
      '0x97d2dba09fca62f3e634d850ab7d8fd7adc7d9e4',
    );
    expect(sepolia?.pactoGov?.navePirataRegistry?.toLowerCase()).not.toBe(
      '0xb4e9349540ed00a7a76da52e1bbe562d9587ba23',
    );
    expect(sepolia?.pactoGov?.navePirataRegistry?.toLowerCase()).not.toBe(
      '0xede67e7f75cd12f3517aafd15d711956f3d95850',
    );
    expect(sepolia?.globalUsernameSponsor?.sponsorPolicyRegistry?.toLowerCase()).not.toBe(
      '0x1350f096fa383e0d73c02fc13797f207295ef248',
    );
    expect(sepolia?.globalUsernameSponsor?.sponsorPolicyRegistry?.toLowerCase()).not.toBe(
      '0xa70590c06feab74a2df569290d8cd8392b699ae4',
    );
    expect(sepolia?.squadSponsor?.factory?.toLowerCase()).not.toBe(
      '0x9f6b1936e1817a074033591bb55dc65cbb29e4d7',
    );
    expect(sepolia?.squadSponsor?.factory?.toLowerCase()).not.toBe(
      '0x280755769367ddd108020eef353a6df0f8355f36',
    );
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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashNostrClaim, npubHashFromPubkey, type Address } from './nostr_claim_link';
import type { Hex } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'claim-link.golden.json'), 'utf8')) as {
  pubkey: Hex;
  evmAddress: Address;
  name: string;
  nonce: number;
  issuedAt: number;
  salt: Hex;
  npubHash: Hex;
  nostrClaimDigest: Hex;
  nostrSignature: string;
};

describe('nostr_claim_link', () => {
  it('matches claim-link.golden.json npubHash', () => {
    expect(npubHashFromPubkey(golden.pubkey).toLowerCase()).toBe(golden.npubHash.toLowerCase());
  });

  it('matches claim-link.golden.json nostrClaimDigest', () => {
    const digest = hashNostrClaim({
      pubkey: golden.pubkey,
      evmAddress: golden.evmAddress,
      name: golden.name,
      nonce: golden.nonce,
      issuedAt: golden.issuedAt,
      salt: golden.salt,
    });
    expect(digest.toLowerCase()).toBe(golden.nostrClaimDigest.toLowerCase());
  });

  it('golden nostrSignature is 64 bytes hex', () => {
    expect(golden.nostrSignature).toMatch(/^[0-9a-f]{128}$/i);
  });
});

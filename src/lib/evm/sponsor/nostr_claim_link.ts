/**
 * Nostr claim-link digests matching pacto-username-nft `NostrClaimLink.sol`.
 * Golden: `./claim-link.golden.json`.
 */

import { concat, keccak256, sha256, stringToHex, toBytes, type Hex } from 'viem';

export type Address = `0x${string}`;

/** keccak256 of the PactoNostrClaim type string. */
export const NOSTR_CLAIM_TYPEHASH =
  '0xe29cf6255f2ca32d485adabf2f756cf068edd7e00df2a290f1349a9a9c9ce4e2' as const;

function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

function assertBytes32(label: string, hex: string): string {
  const raw = strip0x(hex).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new Error(`${label} must be 32 bytes hex`);
  }
  return raw;
}

function padAddress(address: Address): string {
  const raw = strip0x(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(raw)) {
    throw new Error('address must be 20 bytes hex');
  }
  return raw.padStart(64, '0');
}

function padUint256(value: number | bigint): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n || n > 2n ** 256n - 1n) {
    throw new Error('value out of uint256 range');
  }
  return n.toString(16).padStart(64, '0');
}

/** `sha256(0x02 || pubkey)` — matches bech32 npub decoded bytes. */
export function npubHashFromPubkey(pubkey: Hex): Hex {
  const raw = assertBytes32('pubkey', pubkey);
  return sha256(concat([toBytes('0x02'), toBytes(`0x${raw}` as Hex)]));
}

/**
 * Struct hash signed with BIP-340 for username mint.
 * `digest = keccak256(abi.encode(typehash, pubkey, evmAddress, keccak256(name), nonce, issuedAt, salt))`
 */
export function hashNostrClaim(params: {
  pubkey: Hex;
  evmAddress: Address;
  name: string;
  nonce: number | bigint;
  issuedAt: number | bigint;
  salt: Hex;
}): Hex {
  const pubkey = assertBytes32('pubkey', params.pubkey);
  const salt = assertBytes32('salt', params.salt);
  const nameHash = strip0x(keccak256(stringToHex(params.name)));

  const encoded =
    strip0x(NOSTR_CLAIM_TYPEHASH) +
    pubkey +
    padAddress(params.evmAddress) +
    nameHash +
    padUint256(params.nonce) +
    padUint256(params.issuedAt) +
    salt;

  return keccak256(`0x${encoded}`);
}

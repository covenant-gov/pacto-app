/**
 * Encode `paymasterAndData` for `PactoSponsorPaymaster` (ERC-4337 EntryPoint v0.7).
 *
 * Layout:
 *   [0:20]  paymaster
 *   [20:36] uint128 verificationGasLimit
 *   [36:52] uint128 postOpGasLimit
 *   [52:]   abi.encode(uint8 version, bytes32 squadId, address sponsor, address member)
 *
 * Vendored from pacto-squad-sponsor `client/encodePaymasterAndData.ts`.
 * Vectors: `./paymasterAndData.vectors.json`.
 */

export const PAYMASTER_DATA_VERSION = 1 as const;
export const PAYMASTER_DATA_OFFSET = 52 as const;
export const BALANCE_HEADROOM_BPS = 11_500 as const;
/** Paymaster header verification gas (matches Rust DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT). */
export const DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT = 500_000 as const;
export const DEFAULT_POST_OP_GAS_LIMIT = 50_000 as const;

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type EncodePaymasterAndDataParams = {
  paymaster: Address;
  squadId: Hex; // bytes32
  sponsor: Address;
  member: Address;
  verificationGasLimit?: number | bigint;
  postOpGasLimit?: number | bigint;
  version?: number;
};

function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

function assertHexLength(label: string, hex: string, byteLength: number): void {
  const raw = strip0x(hex);
  if (!/^[0-9a-fA-F]*$/.test(raw)) {
    throw new Error(`${label} is not hex`);
  }
  if (raw.length !== byteLength * 2) {
    throw new Error(`${label} must be ${byteLength} bytes (got ${raw.length / 2})`);
  }
}

function padUint256(value: number | bigint): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n || n > 2n ** 256n - 1n) {
    throw new Error('value out of uint256 range');
  }
  return n.toString(16).padStart(64, '0');
}

function padAddress(address: Address): string {
  assertHexLength('address', address, 20);
  return strip0x(address).toLowerCase().padStart(64, '0');
}

function encodeUint128(value: number | bigint): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n || n > 2n ** 128n - 1n) {
    throw new Error('value out of uint128 range');
  }
  return n.toString(16).padStart(32, '0');
}

/** abi.encode(uint8, bytes32, address, address) — 128 bytes. */
export function encodePaymasterPayload(params: {
  version?: number;
  squadId: Hex;
  sponsor: Address;
  member: Address;
}): Hex {
  const version = params.version ?? PAYMASTER_DATA_VERSION;
  if (version < 0 || version > 255) {
    throw new Error('version out of uint8 range');
  }
  assertHexLength('squadId', params.squadId, 32);

  const payload =
    padUint256(version) +
    strip0x(params.squadId).toLowerCase() +
    padAddress(params.sponsor) +
    padAddress(params.member);

  return `0x${payload}`;
}

/** Full ERC-4337 `paymasterAndData` (52-byte header + 128-byte payload). */
export function encodePaymasterAndData(params: EncodePaymasterAndDataParams): Hex {
  assertHexLength('paymaster', params.paymaster, 20);

  const verificationGasLimit =
    params.verificationGasLimit ?? DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT;
  const postOpGasLimit = params.postOpGasLimit ?? DEFAULT_POST_OP_GAS_LIMIT;

  const header =
    strip0x(params.paymaster).toLowerCase() +
    encodeUint128(verificationGasLimit) +
    encodeUint128(postOpGasLimit);

  const payload = strip0x(
    encodePaymasterPayload({
      version: params.version,
      squadId: params.squadId,
      sponsor: params.sponsor,
      member: params.member,
    }),
  );

  const out = `0x${header}${payload}` as Hex;
  if ((out.length - 2) / 2 !== 180) {
    throw new Error(`unexpected paymasterAndData length ${(out.length - 2) / 2}`);
  }
  return out;
}

/** Pool wei required for a given EntryPoint `maxCost` (115% headroom). */
export function requiredPoolBalance(maxCostWei: bigint): bigint {
  return (maxCostWei * BigInt(BALANCE_HEADROOM_BPS)) / 10_000n;
}

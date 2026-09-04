/**
 * Encode `paymasterAndData` for `PactoGlobalPaymaster` (ERC-4337 EntryPoint v0.7).
 *
 * Layout:
 *   [0:20]  paymaster
 *   [20:36] uint128 verificationGasLimit
 *   [36:52] uint128 postOpGasLimit
 *   [52:]   abi.encode(uint8 version, bytes32 npubHash, address member, address policy)
 *
 * Member path: `policy` must be the zero address. Vectors: `./globalPaymasterAndData.vectors.json`.
 */

export const GLOBAL_PAYMASTER_DATA_VERSION = 1 as const;
export const GLOBAL_PAYMASTER_DATA_OFFSET = 52 as const;
export const GLOBAL_BALANCE_HEADROOM_BPS = 11_500 as const;
export const DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT = 500_000 as const;
export const DEFAULT_GLOBAL_POST_OP_GAS_LIMIT = 50_000 as const;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type EncodeGlobalPaymasterAndDataParams = {
  paymaster: Address;
  npubHash: Hex;
  member: Address;
  /** Member path must use the zero address. */
  policy?: Address;
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
export function encodeGlobalPaymasterPayload(params: {
  version?: number;
  npubHash: Hex;
  member: Address;
  policy?: Address;
}): Hex {
  const version = params.version ?? GLOBAL_PAYMASTER_DATA_VERSION;
  if (version < 0 || version > 255) {
    throw new Error('version out of uint8 range');
  }
  assertHexLength('npubHash', params.npubHash, 32);
  const policy = params.policy ?? ZERO_ADDRESS;

  const payload =
    padUint256(version) +
    strip0x(params.npubHash).toLowerCase() +
    padAddress(params.member) +
    padAddress(policy);

  return `0x${payload}`;
}

/** Full ERC-4337 `paymasterAndData` (52-byte header + 128-byte payload). */
export function encodeGlobalPaymasterAndData(params: EncodeGlobalPaymasterAndDataParams): Hex {
  assertHexLength('paymaster', params.paymaster, 20);

  const verificationGasLimit =
    params.verificationGasLimit ?? DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT;
  const postOpGasLimit = params.postOpGasLimit ?? DEFAULT_GLOBAL_POST_OP_GAS_LIMIT;

  const header =
    strip0x(params.paymaster).toLowerCase() +
    encodeUint128(verificationGasLimit) +
    encodeUint128(postOpGasLimit);

  const payload = strip0x(
    encodeGlobalPaymasterPayload({
      version: params.version,
      npubHash: params.npubHash,
      member: params.member,
      policy: params.policy,
    }),
  );

  const out = `0x${header}${payload}` as Hex;
  if ((out.length - 2) / 2 !== 180) {
    throw new Error(`unexpected paymasterAndData length ${(out.length - 2) / 2}`);
  }
  return out;
}

/** Pool wei required for a given EntryPoint `maxCost` (115% headroom). */
export function requiredGlobalPoolBalance(maxCostWei: bigint): bigint {
  return (maxCostWei * BigInt(GLOBAL_BALANCE_HEADROOM_BPS)) / 10_000n;
}

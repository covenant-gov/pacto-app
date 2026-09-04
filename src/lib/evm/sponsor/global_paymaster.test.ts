import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import book from '../pacto-protocol-addresses.json';
import {
  encodeGlobalPaymasterAndData,
  encodeGlobalPaymasterPayload,
  requiredGlobalPoolBalance,
  type Address,
  type Hex,
} from './global_paymaster';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, 'globalPaymasterAndData.vectors.json'), 'utf8'),
) as {
  encoding: {
    inputs: {
      paymaster: Address;
      verificationGasLimit: number;
      postOpGasLimit: number;
      version: number;
      npubHash: Hex;
      member: Address;
      policy: Address;
    };
    header: Hex;
    payload: Hex;
    paymasterAndData: Hex;
    paymasterAndDataLengthBytes: number;
  };
  headroom: {
    maxCostWei: string;
    requiredBalanceWei: string;
  };
  sepolia: {
    pactoGlobalPaymaster: string;
  };
};

describe('encodeGlobalPaymasterAndData (input validation)', () => {
  const valid = {
    paymaster: `0x${'44'.repeat(20)}` as Address,
    npubHash: `0x${'11'.repeat(32)}` as Hex,
    member: `0x${'33'.repeat(20)}` as Address,
  };

  it('rejects a 19-byte address', () => {
    expect(() =>
      encodeGlobalPaymasterPayload({ ...valid, member: `0x${'33'.repeat(19)}` as Address }),
    ).toThrowError('address must be 20 bytes (got 19)');
  });

  it('rejects npubHash with wrong length', () => {
    expect(() =>
      encodeGlobalPaymasterPayload({ ...valid, npubHash: `0x${'11'.repeat(31)}` as Hex }),
    ).toThrowError('npubHash must be 32 bytes (got 31)');
  });

  it('rejects verificationGasLimit above uint128 max', () => {
    expect(() =>
      encodeGlobalPaymasterAndData({ ...valid, verificationGasLimit: 2n ** 128n }),
    ).toThrowError('value out of uint128 range');
  });
});

describe('encodeGlobalPaymasterAndData (golden vectors)', () => {
  it('matches global paymasterAndData encoding', () => {
    const { inputs, payload, paymasterAndData, paymasterAndDataLengthBytes } = vectors.encoding;
    const encodedPayload = encodeGlobalPaymasterPayload({
      version: inputs.version,
      npubHash: inputs.npubHash,
      member: inputs.member,
      policy: inputs.policy,
    });
    expect(encodedPayload.toLowerCase()).toBe(payload.toLowerCase());

    const full = encodeGlobalPaymasterAndData({
      paymaster: inputs.paymaster,
      npubHash: inputs.npubHash,
      member: inputs.member,
      policy: inputs.policy,
      verificationGasLimit: inputs.verificationGasLimit,
      postOpGasLimit: inputs.postOpGasLimit,
      version: inputs.version,
    });
    expect(full.toLowerCase()).toBe(paymasterAndData.toLowerCase());
    expect((full.length - 2) / 2).toBe(paymasterAndDataLengthBytes);
  });

  it('defaults policy to the zero address', () => {
    const { inputs, paymasterAndData } = vectors.encoding;
    const full = encodeGlobalPaymasterAndData({
      paymaster: inputs.paymaster,
      npubHash: inputs.npubHash,
      member: inputs.member,
      verificationGasLimit: inputs.verificationGasLimit,
      postOpGasLimit: inputs.postOpGasLimit,
      version: inputs.version,
    });
    expect(full.toLowerCase()).toBe(paymasterAndData.toLowerCase());
  });

  it('matches pool headroom formula', () => {
    expect(requiredGlobalPoolBalance(BigInt(vectors.headroom.maxCostWei))).toBe(
      BigInt(vectors.headroom.requiredBalanceWei),
    );
  });

  it('Sepolia address book exposes a global paymaster pin', () => {
    const sepolia = book.networks.sepolia.globalUsernameSponsor;
    expect(sepolia?.pactoGlobalPaymaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(sepolia?.protocolRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // Encoding golden vectors keep a fixed paymaster address for layout stability.
    expect(vectors.encoding.inputs.paymaster.toLowerCase()).toBe(
      vectors.sepolia.pactoGlobalPaymaster.toLowerCase(),
    );
  });
});

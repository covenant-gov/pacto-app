import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import policy from '../userop-bundler-policy.json';
import {
  BALANCE_HEADROOM_BPS,
  encodePaymasterAndData,
  encodePaymasterPayload,
  requiredPoolBalance,
  type Address,
  type Hex,
} from './encodePaymasterAndData';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, 'paymasterAndData.vectors.json'), 'utf8'),
) as {
  constants: {
    BALANCE_HEADROOM_BPS: number;
  };
  encoding: {
    inputs: {
      paymaster: Address;
      verificationGasLimit: number;
      postOpGasLimit: number;
      version: number;
      squadId: Hex;
      sponsor: Address;
      member: Address;
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
  fixtureAddresses: {
    paymaster: Address;
  };
};

describe('encodePaymasterAndData (input validation)', () => {
  const valid = {
    paymaster: `0x${'44'.repeat(20)}` as Address,
    squadId: `0x${'11'.repeat(32)}` as Hex,
    sponsor: `0x${'22'.repeat(20)}` as Address,
    member: `0x${'33'.repeat(20)}` as Address,
  };

  it('rejects a 19-byte address', () => {
    expect(() =>
      encodePaymasterPayload({ ...valid, sponsor: `0x${'22'.repeat(19)}` as Address }),
    ).toThrowError('address must be 20 bytes (got 19)');
  });

  it('rejects an address with non-hex characters', () => {
    expect(() =>
      encodePaymasterPayload({ ...valid, member: `0x${'zz'.repeat(20)}` as Address }),
    ).toThrowError('address is not hex');
  });

  it('rejects verificationGasLimit above uint128 max', () => {
    expect(() =>
      encodePaymasterAndData({ ...valid, verificationGasLimit: 2n ** 128n }),
    ).toThrowError('value out of uint128 range');
  });

  it('rejects version above uint8 max', () => {
    expect(() => encodePaymasterPayload({ ...valid, version: 256 })).toThrowError(
      'version out of uint8 range',
    );
  });

  it('rejects a negative version', () => {
    expect(() => encodePaymasterPayload({ ...valid, version: -1 })).toThrowError(
      'version out of uint8 range',
    );
  });
});

describe('encodePaymasterAndData (golden vectors)', () => {
  it('matches sponsor-repo paymasterAndData encoding', () => {
    const { inputs, payload, paymasterAndData, paymasterAndDataLengthBytes } = vectors.encoding;
    const encodedPayload = encodePaymasterPayload({
      version: inputs.version,
      squadId: inputs.squadId,
      sponsor: inputs.sponsor,
      member: inputs.member,
    });
    expect(encodedPayload.toLowerCase()).toBe(payload.toLowerCase());

    const full = encodePaymasterAndData({
      paymaster: inputs.paymaster,
      squadId: inputs.squadId,
      sponsor: inputs.sponsor,
      member: inputs.member,
      verificationGasLimit: inputs.verificationGasLimit,
      postOpGasLimit: inputs.postOpGasLimit,
      version: inputs.version,
    });
    expect(full.toLowerCase()).toBe(paymasterAndData.toLowerCase());
    expect((full.length - 2) / 2).toBe(paymasterAndDataLengthBytes);
  });

  it('matches pool headroom formula', () => {
    expect(requiredPoolBalance(BigInt(vectors.headroom.maxCostWei))).toBe(
      BigInt(vectors.headroom.requiredBalanceWei),
    );
  });

  it('reads pool headroom from the bundler policy', () => {
    expect(BALANCE_HEADROOM_BPS).toBe(policy.poolBalanceHeadroomBps);
    expect(vectors.constants.BALANCE_HEADROOM_BPS).toBe(policy.poolBalanceHeadroomBps);
    expect(policy.poolBalanceHeadroomBps).toBe(11500);
  });

  it('keeps encoding goldens on a fixture paymaster, not the live book pin', () => {
    expect(vectors.encoding.inputs.paymaster.toLowerCase()).toBe(
      vectors.fixtureAddresses.paymaster.toLowerCase(),
    );
  });
});

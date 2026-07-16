import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
  sepolia: {
    squadSponsorFactory: string;
    pactoSponsorPaymaster: string;
  };
};

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

  it('Sepolia addresses match the protocol address book redeploy', () => {
    expect(vectors.sepolia.squadSponsorFactory.toLowerCase()).toBe(
      '0x032e84cff3b32c221f8F93e4839Fa5715638ae08'.toLowerCase(),
    );
    expect(vectors.sepolia.pactoSponsorPaymaster.toLowerCase()).toBe(
      '0xF7f557a9443671EB0f5a3F1b233Ac44A9eDa24B8'.toLowerCase(),
    );
  });
});

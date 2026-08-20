import { describe, expect, it } from 'vitest';
import { type Abi, encodeFunctionData, parseEther } from 'viem';
import erc20Write from '../evm/abis/erc20-write.json';
import { encodeSetCrewVoteMode, encodeSetQuorumBps } from './crew-vote-mode';
import {
  formatNativeEthAmount,
  isDelegateCallOperation,
  shortCalldataSelector,
  summarizeTreasuryProposalAction,
} from './proposal-action-summary';

const ABI = erc20Write as Abi;
const TOKEN = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const SPENDER = '0x3333333333333333333333333333333333333333';

describe('summarizeTreasuryProposalAction', () => {
  it('classifies empty calldata as native transfer', () => {
    const summary = summarizeTreasuryProposalAction({
      to: RECIPIENT,
      valueWei: parseEther('1.5').toString(),
      dataHex: '0x',
      operation: 'call',
    });
    expect(summary).toEqual({
      kind: 'native_transfer',
      to: RECIPIENT,
      valueWei: parseEther('1.5').toString(),
      isDelegateCall: false,
    });
    expect(formatNativeEthAmount(summary.valueWei)).toBe('1.5');
  });

  it('decodes erc20 transfer', () => {
    const dataHex = encodeFunctionData({
      abi: ABI,
      functionName: 'transfer',
      args: [RECIPIENT, 1_000_000n],
    });
    const summary = summarizeTreasuryProposalAction({
      to: TOKEN,
      valueWei: '0',
      dataHex,
      operation: 'call',
    });
    expect(summary).toEqual({
      kind: 'erc20_transfer',
      token: TOKEN,
      to: RECIPIENT,
      amountRaw: '1000000',
      valueWei: '0',
      isDelegateCall: false,
    });
  });

  it('decodes erc20 approve', () => {
    const dataHex = encodeFunctionData({
      abi: ABI,
      functionName: 'approve',
      args: [SPENDER, 42n],
    });
    const summary = summarizeTreasuryProposalAction({
      to: TOKEN,
      valueWei: '0',
      dataHex,
      operation: 'call',
    });
    expect(summary).toEqual({
      kind: 'erc20_approve',
      token: TOKEN,
      spender: SPENDER,
      amountRaw: '42',
      valueWei: '0',
      isDelegateCall: false,
    });
  });

  it('keeps native valueWei on an erc20 transfer', () => {
    const dataHex = encodeFunctionData({
      abi: ABI,
      functionName: 'transfer',
      args: [RECIPIENT, 1_000_000n],
    });
    const valueWei = parseEther('0.25').toString();
    const summary = summarizeTreasuryProposalAction({
      to: TOKEN,
      valueWei,
      dataHex,
      operation: 'call',
    });
    expect(summary.kind).toBe('erc20_transfer');
    if (summary.kind !== 'erc20_transfer') return;
    expect(summary.valueWei).toBe(valueWei);
    expect(formatNativeEthAmount(summary.valueWei)).toBe('0.25');
  });

  it('fails closed on unknown calldata with short selector', () => {
    const dataHex = '0xdeadbeef00000000000000000000000000000000000000000000000000000001';
    const summary = summarizeTreasuryProposalAction({
      to: TOKEN,
      valueWei: '0',
      dataHex,
      operation: 'call',
    });
    expect(summary.kind).toBe('unknown');
    if (summary.kind !== 'unknown') return;
    expect(summary.selector).toBe('0xdeadbeef');
    expect(summary.dataHex).toBe(dataHex);
    expect(summary.to).toBe(TOKEN);
  });

  it('fails closed on invalid hex (odd length)', () => {
    const summary = summarizeTreasuryProposalAction({
      to: TOKEN,
      valueWei: '0',
      dataHex: '0xabc',
      operation: 'call',
    });
    expect(summary.kind).toBe('unknown');
    if (summary.kind !== 'unknown') return;
    expect(summary.dataHex).toBe('0xabc');
  });

  it('flags delegatecall on summaries', () => {
    const summary = summarizeTreasuryProposalAction({
      to: RECIPIENT,
      valueWei: '0',
      dataHex: '0x',
      operation: 'delegatecall',
    });
    expect(summary.kind).toBe('native_transfer');
    expect(summary.isDelegateCall).toBe(true);
  });

  it('decodes setCrewVoteMode', () => {
    const dataHex = encodeSetCrewVoteMode('quorum');
    const summary = summarizeTreasuryProposalAction({
      to: RECIPIENT,
      valueWei: '0',
      dataHex,
      operation: 'call',
    });
    expect(summary).toEqual({
      kind: 'set_crew_vote_mode',
      mode: 'quorum',
      to: RECIPIENT,
      valueWei: '0',
      isDelegateCall: false,
    });
  });

  it('decodes setQuorumBps', () => {
    const dataHex = encodeSetQuorumBps(2500);
    const summary = summarizeTreasuryProposalAction({
      to: RECIPIENT,
      valueWei: '0',
      dataHex,
      operation: 'call',
    });
    expect(summary).toEqual({
      kind: 'set_quorum_bps',
      quorumBps: 2500,
      to: RECIPIENT,
      valueWei: '0',
      isDelegateCall: false,
    });
  });
});

describe('shortCalldataSelector / isDelegateCallOperation', () => {
  it('extracts 4-byte selectors', () => {
    expect(shortCalldataSelector('0x')).toBe('');
    expect(shortCalldataSelector('0xa9059cbb00')).toBe('0xa9059cbb');
  });

  it('detects delegatecall operation labels', () => {
    expect(isDelegateCallOperation('delegatecall')).toBe(true);
    expect(isDelegateCallOperation('DELEGATECALL')).toBe(true);
    expect(isDelegateCallOperation('call')).toBe(false);
  });
});

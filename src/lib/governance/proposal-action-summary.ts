/**
 * Offline decode of Treasury Authority proposal actions for structured UI.
 * Unknown calldata fails closed (short selector + progressive raw hex in the view).
 */

import { type Abi, type Address, decodeFunctionData, type Hex } from 'viem';
import erc20Write from '../evm/abis/erc20-write.json';
import { normalizeCalldataHex, weiStringToEthDisplay } from '../evm/calldata-builder';

const ERC20_WRITE_ABI = erc20Write as Abi;

export type ProposalActionInput = {
  to: string;
  valueWei: string;
  dataHex: string;
  operation: string;
};

export type ProposalActionSummary =
  | {
      kind: 'native_transfer';
      to: string;
      valueWei: string;
      isDelegateCall: boolean;
    }
  | {
      kind: 'erc20_transfer';
      token: string;
      to: string;
      amountRaw: string;
      valueWei: string;
      isDelegateCall: boolean;
    }
  | {
      kind: 'erc20_approve';
      token: string;
      spender: string;
      amountRaw: string;
      valueWei: string;
      isDelegateCall: boolean;
    }
  | {
      kind: 'unknown';
      to: string;
      valueWei: string;
      selector: string;
      dataHex: string;
      isDelegateCall: boolean;
    };

export function isDelegateCallOperation(operation: string | null | undefined): boolean {
  return (operation ?? '').trim().toLowerCase() === 'delegatecall';
}

/** 4-byte selector display (`0x` + 8 hex), or empty for bare `0x`. */
export function shortCalldataSelector(dataHex: string): string {
  const t = dataHex.trim().toLowerCase();
  if (!t || t === '0x') return '';
  const body = t.startsWith('0x') ? t.slice(2) : t;
  if (body.length < 8) return t.startsWith('0x') ? t : `0x${t}`;
  return `0x${body.slice(0, 8)}`;
}

function unknownSummary(
  input: ProposalActionInput,
  dataHex: string,
  isDelegateCall: boolean,
): Extract<ProposalActionSummary, { kind: 'unknown' }> {
  return {
    kind: 'unknown',
    to: input.to.trim(),
    valueWei: (input.valueWei ?? '0').trim() || '0',
    selector: shortCalldataSelector(dataHex),
    dataHex,
    isDelegateCall,
  };
}

export function summarizeTreasuryProposalAction(input: ProposalActionInput): ProposalActionSummary {
  const isDelegateCall = isDelegateCallOperation(input.operation);
  const to = input.to.trim();
  const valueWei = (input.valueWei ?? '0').trim() || '0';

  let data: Hex;
  try {
    data = normalizeCalldataHex(input.dataHex ?? '0x');
  } catch {
    const raw = (input.dataHex ?? '').trim() || '0x';
    return unknownSummary({ ...input, to, valueWei }, raw, isDelegateCall);
  }

  if (data === '0x') {
    return { kind: 'native_transfer', to, valueWei, isDelegateCall };
  }

  try {
    const decoded = decodeFunctionData({ abi: ERC20_WRITE_ABI, data });
    if (decoded.functionName === 'transfer') {
      const [recipient, amount] = decoded.args as readonly [Address, bigint];
      return {
        kind: 'erc20_transfer',
        token: to,
        to: recipient,
        amountRaw: amount.toString(),
        valueWei,
        isDelegateCall,
      };
    }
    if (decoded.functionName === 'approve') {
      const [spender, amount] = decoded.args as readonly [Address, bigint];
      return {
        kind: 'erc20_approve',
        token: to,
        spender,
        amountRaw: amount.toString(),
        valueWei,
        isDelegateCall,
      };
    }
  } catch {
    // fall through to unknown
  }

  return unknownSummary({ ...input, to, valueWei }, data, isDelegateCall);
}

/** Native ETH amount for display (wei decimal string → ETH string). */
export function formatNativeEthAmount(valueWei: string): string {
  return weiStringToEthDisplay(valueWei);
}

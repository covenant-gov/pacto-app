import type { SupportedChainId } from '../wallet/chains';
import { getExplorerTxUrl, explorerTxLinkLabel } from '../wallet/assets';
import { walletWaitForTransaction, parseWalletOpError } from '../wallet/backend-wallet';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { showToast } from '../../stores/toast';

export function toastOnChainSubmitted(
  network: SupportedChainId,
  txHash: string,
  subject = 'Transaction',
): void {
  const short = txHash.length > 14 ? `${txHash.slice(0, 10)}…${txHash.slice(-4)}` : txHash;
  const explorer = getExplorerTxUrl(network, txHash);
  const label = explorerTxLinkLabel(network);
  showToast(
    explorer
      ? `${subject} submitted (${short}). Track on ${label} while it confirms.`
      : `${subject} submitted (${short}). Confirmation continues in the background.`,
  );
}

export function toastOnChainConfirmed(network: string, txHash: string, subject = 'Transaction'): void {
  const short = txHash.length > 14 ? `${txHash.slice(0, 10)}…${txHash.slice(-4)}` : txHash;
  showToast(`${subject} confirmed on ${network}. Tx ${short}`);
}

export function toastOnChainFailed(message: string): void {
  showToast(message);
}

/** Poll receipt without blocking UI; optional hooks for follow-up work. */
export function waitForOnChainConfirmationInBackground(
  network: SupportedChainId,
  txHash: string,
  opts?: {
    onConfirmed?: () => void | Promise<void>;
    onFailed?: (message: string) => void;
    confirmedToast?: boolean;
    subject?: string;
  },
): void {
  void walletWaitForTransaction(network, txHash).then(async (wait) => {
    if (wait.ok) {
      await opts?.onConfirmed?.();
      if (opts?.confirmedToast !== false) {
        toastOnChainConfirmed(wait.result.network, wait.result.txHash, opts?.subject);
      }
    } else if (wait.parsed?.code !== 'RECEIPT_TIMEOUT') {
      opts?.onFailed?.(wait.message);
      toastOnChainFailed(wait.message);
    }
  });
}

export interface RunOnChainInBackgroundOpts<T> {
  startedToast?: string;
  subject?: string;
  job: () => Promise<T>;
  onSuccess?: (result: T) => void | Promise<void>;
  onError?: (message: string) => void;
}

/** Queue a long Tauri on-chain invoke; caller should close modals before calling. */
export function runOnChainInBackground<T>(opts: RunOnChainInBackgroundOpts<T>): void {
  if (opts.startedToast) {
    showToast(opts.startedToast);
  }
  void (async () => {
    try {
      const result = await opts.job();
      await opts.onSuccess?.(result);
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'On-chain transaction failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      opts.onError?.(raw);
      toastOnChainFailed(raw);
    }
  })();
}

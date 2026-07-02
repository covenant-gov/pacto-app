import type { SupportedChainId } from './chains';
import {
  formatWalletTxAnnouncement,
  isWalletTxAnnouncementOnChainPending,
  parseWalletTxAnnouncement,
} from './dm-messages';
import {
  walletWaitForTransaction,
  type WalletSendResult,
  type WalletSendResultOutcome,
} from './backend-wallet';
import { getActiveEvmSignerAddress } from './evm-accounts';
import {
  toastOnChainSubmitted,
  toastOnChainConfirmed,
} from '../evm/on-chain-background';
import { get } from 'svelte/store';
import {
  appendPendingOutboundDmMessage,
  patchOutboundWalletTxByHash,
  backendDmMessages,
  type DmMessage,
} from '../../stores/dm';
import { showToast } from '../../stores/toast';

export interface WalletDmTransferAfterBroadcastParams {
  peerNpub: string;
  network: SupportedChainId;
  asset: string;
  amount: string;
  txHash: string;
  fromNpub: string;
  requestId?: string;
  sendDm: (content: string) => Promise<boolean>;
  onBalanceRefresh?: () => void | Promise<void>;
}

const RECEIPT_RETRY_DELAY_MS = 15_000;
const RECEIPT_RETRY_ATTEMPTS = 24;
const relayedWalletTxKeys = new Set<string>();

function relayKey(peerNpub: string, txHash: string): string {
  return `${peerNpub.trim()}:${txHash.trim().toLowerCase()}`;
}

function peerThreadAlreadyHasRelayedWalletTx(peerNpub: string, txHash: string): boolean {
  const needle = txHash.trim().toLowerCase();
  const list = get(backendDmMessages)[peerNpub.trim()] ?? [];
  return list.some((m) => {
    if (m.id?.startsWith('opt-')) return false;
    const ann = parseWalletTxAnnouncement(m.content ?? '');
    return ann?.tx_hash.toLowerCase() === needle;
  });
}

function announcementContent(params: {
  network: SupportedChainId;
  asset: string;
  amount: string;
  txHash: string;
  fromNpub: string;
  peerNpub: string;
  fromEvm: string;
  requestId?: string;
  blockNumber?: string;
}): string {
  return formatWalletTxAnnouncement({
    network: params.network,
    asset: params.asset,
    amount: params.amount,
    tx_hash: params.txHash,
    from_npub: params.fromNpub,
    to_npub: params.peerNpub,
    from_evm_address: params.fromEvm,
    ...(params.requestId ? { request_id: params.requestId } : {}),
    ...(params.blockNumber ? { block_number: params.blockNumber } : {}),
  });
}

async function waitForReceiptWithRetries(
  network: SupportedChainId,
  txHash: string,
): Promise<WalletSendResultOutcome> {
  let wait = await walletWaitForTransaction(network, txHash);
  if (wait.ok || wait.parsed?.code !== 'RECEIPT_TIMEOUT') {
    return wait;
  }
  for (let i = 0; i < RECEIPT_RETRY_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, RECEIPT_RETRY_DELAY_MS));
    wait = await walletWaitForTransaction(network, txHash);
    if (wait.ok || wait.parsed?.code !== 'RECEIPT_TIMEOUT') {
      return wait;
    }
  }
  return wait;
}

function applyConfirmedWalletTx(
  params: WalletDmTransferAfterBroadcastParams,
  fromEvm: string,
  blockNumber?: string,
): string {
  const confirmedContent = announcementContent({
    network: params.network,
    asset: params.asset,
    amount: params.amount,
    txHash: params.txHash,
    fromNpub: params.fromNpub,
    peerNpub: params.peerNpub,
    fromEvm,
    requestId: params.requestId,
    blockNumber,
  });
  patchOutboundWalletTxByHash(params.peerNpub, params.txHash, {
    content: confirmedContent,
    pending: false,
    failed: false,
  });
  return confirmedContent;
}

async function relayConfirmedWalletTx(
  params: WalletDmTransferAfterBroadcastParams,
  confirmedContent: string,
): Promise<void> {
  const key = relayKey(params.peerNpub, params.txHash);
  if (relayedWalletTxKeys.has(key) || peerThreadAlreadyHasRelayedWalletTx(params.peerNpub, params.txHash)) {
    return;
  }
  relayedWalletTxKeys.add(key);
  try {
    const ok = await params.sendDm(confirmedContent);
    if (!ok) {
      relayedWalletTxKeys.delete(key);
      showToast('Transfer confirmed, but the payment note could not be relayed.');
    }
  } catch {
    relayedWalletTxKeys.delete(key);
    showToast('Transfer confirmed, but the payment note could not be relayed.');
  }
}

async function finalizeConfirmed(
  params: WalletDmTransferAfterBroadcastParams,
  fromEvm: string,
  wait: WalletSendResultOutcome & { ok: true },
): Promise<void> {
  const confirmedContent = applyConfirmedWalletTx(
    params,
    fromEvm,
    wait.result.blockNumber,
  );
  await relayConfirmedWalletTx(params, confirmedContent);
  await params.onBalanceRefresh?.();
  toastOnChainConfirmed(wait.result.network, params.txHash, 'Transfer');
}

/** Optimistic chat card + background confirmation + relay of `wallet_tx_announcement`. */
export async function finalizeWalletDmTransferAfterBroadcast(
  params: WalletDmTransferAfterBroadcastParams,
): Promise<void> {
  const fromEvm = await getActiveEvmSignerAddress();
  if (!fromEvm) {
    showToast('Transfer submitted, but the payment note was skipped (no active EVM address).');
    return;
  }

  const optimisticContent = announcementContent({
    network: params.network,
    asset: params.asset,
    amount: params.amount,
    txHash: params.txHash,
    fromNpub: params.fromNpub,
    peerNpub: params.peerNpub,
    fromEvm,
    requestId: params.requestId,
  });
  appendPendingOutboundDmMessage(params.peerNpub, optimisticContent);

  const wait = await waitForReceiptWithRetries(params.network, params.txHash);
  if (!wait.ok) {
    if (wait.parsed?.code === 'RECEIPT_TIMEOUT') {
      showToast('Submitted — still waiting for confirmation. Check the explorer from the chat card.');
      return;
    }
    patchOutboundWalletTxByHash(params.peerNpub, params.txHash, {
      pending: false,
      failed: true,
    });
    showToast(wait.message);
    return;
  }

  await finalizeConfirmed(params, fromEvm, wait);
}

const resumeInFlight = new Set<string>();

/** Reconcile optimistic `opt-` wallet cards left pending after timeout or app restart. */
export function resumePendingWalletTxConfirmations(
  peerNpub: string,
  messages: DmMessage[],
  ctx: {
    fromNpub: string;
    sendDm: (content: string) => Promise<boolean>;
    onBalanceRefresh?: () => void | Promise<void>;
  },
): void {
  const peer = peerNpub.trim();
  if (!peer) return;
  const seenTx = new Set<string>();
  for (const msg of messages) {
    if (!msg.mine) continue;
    const ann = parseWalletTxAnnouncement(msg.content ?? '');
    if (!ann || !isWalletTxAnnouncementOnChainPending(ann, msg)) continue;
    const key = `${peer}:${ann.tx_hash.toLowerCase()}`;
    if (seenTx.has(key) || resumeInFlight.has(key)) continue;
    seenTx.add(key);
    resumeInFlight.add(key);
    void (async () => {
      try {
        const fromEvm = await getActiveEvmSignerAddress();
        if (!fromEvm) return;
        const params: WalletDmTransferAfterBroadcastParams = {
          peerNpub: peer,
          network: ann.network,
          asset: ann.asset,
          amount: ann.amount,
          txHash: ann.tx_hash,
          fromNpub: ctx.fromNpub,
          requestId: ann.request_id,
          sendDm: ctx.sendDm,
          onBalanceRefresh: ctx.onBalanceRefresh,
        };
        const wait = await waitForReceiptWithRetries(ann.network, ann.tx_hash);
        if (!wait.ok) {
          if (wait.parsed?.code !== 'RECEIPT_TIMEOUT') {
            patchOutboundWalletTxByHash(peer, ann.tx_hash, { pending: false, failed: true });
          }
          return;
        }
        await finalizeConfirmed(params, fromEvm, wait);
      } finally {
        resumeInFlight.delete(key);
      }
    })();
  }
}

export function toastWalletBroadcastSubmitted(result: WalletSendResult): void {
  toastOnChainSubmitted(result.network as SupportedChainId, result.txHash, 'Transaction');
}

# Wallet transaction lifecycle (DM announcements)

This document defines **when a transfer counts as “done”** and when the **DM transaction announcement** is posted. It applies to WalletBar send flows and to request flows that end in an on-chain transfer.

DM messages are **immutable**, so we cannot reliably “upgrade” a single message from pending to confirmed. Pacto should not claim a successful transfer in chat until the chain reports a **successful receipt**.

---

## Decision

### Success = receipt with success status, then announce

1. **Broadcast** the signed transaction and obtain `tx_hash`.
2. **Wait** for the transaction receipt on the same chain (JSON-RPC `eth_getTransactionReceipt` polling with backoff, or equivalent in Rust).
3. Treat the operation as **successful for product purposes** only when:
   - A receipt exists, and  
   - `status` indicates **success** (EIP-155: `0x1` success; failed/`0x0` is an error).
4. **Only then:**
   - Close the send modal (or show final success state).
   - Post the **`wallet_tx_announcement`** DM with amount, asset, network, `tx_hash`, **`from_evm_address`** (active signer), and a **confirmed** status label (field-level shape: [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md)).
5. If receipt wait **times out**, return a **structured error** that includes `tx_hash` (when known) and copy that tells the user to check a block explorer — **do not** post a DM that claims the transfer succeeded.

### What we do *not* do for MVP

- **Announce on submit only:** A transaction can still **revert** after being included. Posting a permanent DM as if the transfer succeeded would be **misleading** in that case.
- **Single DM with later “edit” to confirmed:** Nostr/DM payloads are not edited in place for this use case; avoid relying on a follow-up correction message as the primary truth.

---

## UX consequences

| Stage | User sees |
|--------|-----------|
| Confirm clicked | Loading state; modal stays open (or explicit “Submitting…” step). |
| Tx in mempool / waiting receipt | Same; optional subtext: “Waiting for confirmation…” (no success claim). |
| Receipt success | Modal closes; toast optional; **DM announcement posted** as confirmed. |
| Receipt failure (revert) | Error with short explanation; **no** success announcement. |
| Timeout waiting receipt | Error: confirmation timed out; include hash + explorer hint; **no** success announcement. |

---

## Backend contract (for `wallet_build_and_send_transaction`)

Suggested return shape on full success:

- `tx_hash`
- `network_id`
- `asset`, `amount` (echo / canonical)
- `block_number` (optional, for support)
- `status`: `"confirmed"` (only returned on success path)

**Desktop (current):** The Tauri command returns `txHash`, `network`, `chainId`, and optional camelCase `blockNumber` (decimal string). The Svelte client fills `asset` / `amount` from the send form and posts the announcement JSON to the DM.

On failure: `Err` or structured error with `code`, `message`, and optional `tx_hash` if the tx was broadcast but reverted or timed out.

The implementation may use the same JSON-RPC endpoint as broadcast for `eth_getTransactionReceipt` polling.

---

## Timeouts and tuning

- Define a **maximum wait** (order of **1–3 minutes** depending on network; shorter on L2s). Document in backend config.
- **Desktop (current):** `wallet_build_and_send_transaction` uses **180s** for the receipt wait after broadcast (`RECEIPT_WAIT_TIMEOUT` in `wallet_ops.rs`). On timeout it returns `RECEIPT_TIMEOUT` with `txHash` in the structured error JSON so the UI can link to an explorer.
- Poll interval: start ~1s, cap backoff (e.g. 4s) to avoid hammering RPC (handled inside Alloy’s pending-tx watcher).

---

## Optional later

Non-DM **optimistic UI** (e.g. toast “Submitted: view on explorer” with hash) **before** receipt is allowed as long as it does **not** claim final settlement. Permanent **DM** announcements remain **post-receipt only** unless product later adopts a two-message protocol (pending + confirmed) explicitly.

---

## See also

- [README.md](./README.md) — index of wallet docs.

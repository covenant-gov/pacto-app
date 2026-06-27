# On-chain transaction UX (app-wide)

Pacto must **never freeze navigation or modals** while waiting for Ethereum receipt confirmation. Signing and broadcast may take a few seconds; receipt polling may take minutes on congested networks — that work always continues **in the background**.

---

## Rules

1. **Broadcast, then release the UI.** After the signed transaction is submitted to the mempool, close modals / re-enable panels and let the user keep using the app.
2. **Show honest pending state.** Use toasts (“submitted — confirmation continues in the background”), pending badges on DM wallet cards, or dashboard placeholders — never claim final success before a successful receipt.
3. **Poll receipts off the critical path.** Use `wallet_wait_for_transaction` (or domain-specific finalize logic) from a background task; surface confirmation or failure via toast and in-place UI updates.
4. **Permanent DM announcements** follow the optimistic two-phase pattern documented in [DM wallet lifecycle](#dm-wallet-transfers) below.

---

## Backend contract

| Command | Default | Notes |
|---------|---------|--------|
| `wallet_build_and_send_transaction` | `waitForConfirmation: false` | Returns `txHash` after broadcast; optional `blockNumber` when `waitForConfirmation: true`. |
| `wallet_wait_for_transaction` | — | Poll receipt; same result shape as confirmed send. |
| `evm_send_advanced_contract_call` | `waitForConfirmation: false` | Advanced Settings panel. |
| `evm_send_squad_allowlisted_contract_call` | `waitForConfirmation: false` | Dashboard allowlist sends. |
| Deploy / governance commands | still wait for receipt internally | UI closes immediately and runs the invoke in a background job (`runOnChainInBackground`). |

Receipt polling uses **180s** (`RECEIPT_WAIT_TIMEOUT` in `wallet_ops.rs`). On timeout, return `RECEIPT_TIMEOUT` with `txHash` when known.

---

## Frontend helpers

`src/lib/evm/on-chain-background.ts`:

- `runOnChainInBackground` — queue long Tauri invokes (deploy wizards, squad admin writes).
- `waitForOnChainConfirmationInBackground` — poll after broadcast-only send.
- `toastOnChainSubmitted` / `toastOnChainConfirmed` / `toastOnChainFailed`.

DM wallet sends additionally use `finalizeWalletDmTransferAfterBroadcast` (`src/lib/wallet/wallet-dm-transfer.ts`).

---

## DM wallet transfers

### Optimistic chat card + background confirmation

1. **Broadcast** via `wallet_build_and_send_transaction` (`waitForConfirmation: false`).
2. **Immediately** append a local outbound DM row with `pending: true` and a `wallet_tx_announcement` payload (badge: “Transfer pending”).
3. Close the send modal; toast with explorer link.
4. **Background:** `wallet_wait_for_transaction`.
5. On **success:** patch the local row to confirmed content; relay the same JSON to the peer via Nostr; refresh balances; toast confirmation.
6. On **revert:** patch row to `failed: true`.
7. On **timeout:** leave pending; toast to check explorer (do not claim success).

Inbound announcements from peers remain post-receipt only (no optimistic upgrade of relayed messages).

---

## UX table

| Stage | User sees |
|--------|-----------|
| Confirm clicked | Brief signing/submit state (seconds). |
| Tx broadcast | Modal closes (or panel unlocks); toast with hash / explorer; DM card shows **pending** when applicable. |
| Receipt success | Toast; pending UI updates to **confirmed**; relay DM when applicable. |
| Receipt failure (revert) | Toast; failed badge on optimistic card. |
| Timeout | Toast with explorer hint; pending card stays pending. |

---

## See also

- [README.md](./README.md) — wallet doc index.
- [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md) — announcement JSON shape.

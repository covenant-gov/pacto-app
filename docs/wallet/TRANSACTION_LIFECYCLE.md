# On-chain transaction UX (app-wide)

Pacto must **never freeze navigation or modals** while waiting for Ethereum receipt confirmation. Signing and broadcast may take a few seconds; receipt polling may take minutes on congested networks — that work always continues **in the background**.

Every client-originated on-chain write registers a job on `pendingOnChainJobs` (`src/stores/pending-on-chain.ts`). [`OnChainActivityChip`](../../src/components/ui/OnChainActivityChip.svelte) (bottom-right) is the durable pending → confirmed/failed surface. Toasts are transient (single-slot, ~8s) and must not be the only indicator.

---

## Rules

1. **Broadcast, then release the UI.** After the signed transaction is submitted to the mempool, close modals / re-enable panels and let the user keep using the app.
2. **Show honest pending state.** Register a chip job; optional toast (“submitted — confirmation continues in the background”); DM wallet cards stay as conversation artifacts. Never claim final success before a successful receipt.
3. **Poll receipts off the critical path.** Use `wallet_wait_for_transaction` (or domain-specific finalize logic) from a background task; surface confirmation or failure via chip, toast, and in-place UI updates.
4. **Client writes go through the helpers.** No raw `await invoke()` in a modal for receipt.
5. **Permanent DM announcements** follow the optimistic two-phase pattern documented in [DM wallet lifecycle](#dm-wallet-transfers) below.

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

- `runOnChainInBackground` — queue long Tauri invokes (deploy, gov, sponsor). Registers a chip job when `jobLabel` or `subject` is set.
- `waitForOnChainConfirmationInBackground` — poll after broadcast-only send; always registers a chip job.
- `toastOnChainSubmitted` / `toastOnChainConfirmed` / `toastOnChainFailed`.

Squad `acting` writes use `runGovWriteInBackground` (`src/lib/governance/gov-write-background.ts`): submitted toast at start, confirmed toast + `afterGovWrite` refresh on settle.

DM wallet sends additionally use `finalizeWalletDmTransferAfterBroadcast` (`src/lib/wallet/wallet-dm-transfer.ts`).

---

## DM wallet transfers

### Optimistic chat card + background confirmation

1. **Broadcast** via `wallet_build_and_send_transaction` (`waitForConfirmation: false`).
2. **Immediately** append a local outbound DM row with `pending: true` and a `wallet_tx_announcement` payload (badge: “Transfer pending”). Register a chip job.
3. Close the send modal; toast with explorer link.
4. **Background:** `wallet_wait_for_transaction`.
5. On **success:** patch the local row to confirmed content; relay the same JSON to the peer via Nostr; refresh balances; chip → confirmed; toast confirmation.
6. On **revert:** patch row to `failed: true`; chip → failed.
7. On **timeout:** leave pending (card and chip); toast to check explorer (do not claim success).

Inbound announcements from peers remain post-receipt only (no optimistic upgrade of relayed messages).

---

## UX table

| Stage | User sees |
|--------|-----------|
| Confirm clicked | Brief signing/submit state (seconds). |
| Tx broadcast / invoke queued | Modal closes (or panel unlocks); chip shows **pending**; optional submitted toast; DM card shows **pending** when applicable. |
| Receipt success | Chip → **confirmed** then fades; toast; pending UI updates; relay DM when applicable. |
| Receipt failure (revert) | Chip → **failed** then fades; error toast; failed badge on optimistic card. |
| Timeout | Chip stays **pending**; toast with explorer hint; pending card stays pending. |

---

## See also

- [README.md](./README.md) — wallet doc index.
- [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md) — announcement JSON shape.

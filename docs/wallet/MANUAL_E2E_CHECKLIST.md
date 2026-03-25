# Manual E2E checklist — embedded wallet (DM WalletBar)

Use this to verify send, request, announcements, and RPC behavior on a **test network** before relying on mainnet. Run the **desktop (Tauri)** build unless noted.

## Prerequisites

- [ ] **Sepolia ETH** in the sender’s embedded wallet (faucet) for gas.
- [ ] **Sepolia USDC** (and optionally USDT) if testing stable transfers — fund the wallet from a faucet or bridge as needed.
- [ ] **Two participants** in a **1:1 DM** on **Friends** or **Pinned** (wallet button and sidebar only appear there).
- [ ] **Recipient** has **`evm_address`** available to the sender (synced profile / Nostr kind 0). Without it, send returns a structured error (`MISSING_PEER_EVM_ADDRESS`).
- [ ] Optional: set **`PACTO_WALLET_RPC_SEPOLIA`** (comma-separated URLs) if public defaults are flaky. See [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) and [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

## A. Wallet bar & balances

- [ ] Open the DM → open **Wallet** from the chat header → sidebar shows peer + **Balance**.
- [ ] **Refresh** loads per-network rows (mainnet / Optimism / Sepolia) without a hard error.
- [ ] If Sepolia RPC fails, error text should **not** include raw API secrets (see [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) § Logging and RPC URL safety).

## B. Send native ETH (Sepolia)

- [ ] **Send** → choose **Sepolia**, **ETH**, small amount (above dust, within balance).
- [ ] **Confirm** → modal shows waiting state; overlay/Escape **cannot** dismiss while in flight.
- [ ] Success: toast with short **tx hash**; modal closes; **Balance** updates after refresh path runs.
- [ ] Thread shows **`wallet_tx_announcement`** as a **card** (not raw JSON): amount, asset, network, hash.
- [ ] Open **Sepolia Etherscan** (or your explorer) with the hash from the card and confirm **success** receipt.

## C. Send USDC (Sepolia)

- [ ] Repeat **B** with **USDC** and an amount within token balance.
- [ ] Announcement card appears; explorer shows ERC-20 transfer as expected.

## D. Request → Accept → pay → fulfilled

- [ ] As **requester**: **Request** → Sepolia + asset + amount → **Confirm** → DM shows **payment request** card for peer.
- [ ] As **recipient**: **Accept** → wallet sidebar opens with **Send** pre-filled → **Confirm** completes on-chain send.
- [ ] Request card shows **Paid** (or equivalent fulfilled state) when announcement **`request_id`** matches the request.

## E. Decline request

- [ ] Recipient **Decline** → card shows declined state; toast notes **no automatic DM** to requester; requester sees updated card after sync.

## F. Failure paths (spot-check)

- [ ] **Insufficient balance** / bad amount: UI blocks or backend error without crashing the app.
- [ ] **Receipt timeout** (rare): error may include **tx hash** and hint to check explorer; **no** success announcement DM claiming completion (see [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md)).

## G. Dev-only UI smoke

- [ ] In **Vite dev**, **Post test announcement (dev)** posts a fake-hash announcement so **`WalletTxAnnouncementCard`** layout can be checked without a real tx.

---

## See also

- [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md) — payload shapes.
- [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md) — success only after receipt.
- [README.md](./README.md) — index of wallet docs.

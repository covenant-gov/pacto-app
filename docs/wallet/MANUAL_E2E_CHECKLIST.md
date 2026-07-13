# Manual E2E checklist — embedded wallet (DM WalletBar)

Use this to verify send, request, announcements, and RPC behavior on a **test network** before relying on mainnet. Run the **desktop (Tauri)** build unless noted.

## Prerequisites

- [ ] **Sepolia ETH** in the sender’s embedded wallet (faucet) for gas.
- [ ] **Sepolia USDC** (and optionally USDT) if testing stable transfers — fund the wallet from a faucet or bridge as needed.
- [ ] **Two participants** in a **1:1 DM** on **Friends** or **Pinned** (wallet button and sidebar only appear there).
- [ ] **Recipient** payout address is in **`dm_peer_evm`** after a completed wallet-info exchange in this DM. Without it, send returns **`MISSING_PEER_EVM_ADDRESS`**.
- [ ] Optional: set **`ALCHEMY_RPC_KEY`** in `.env` if public defaults are flaky. See [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) and [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

## A0. Wallet address exchange (privacy)

- [ ] Fresh DM: **both** users see **Send exchange request** (not Send/Request), even if either has a Kind 0 profile on relays.
- [ ] User A sends exchange request → card has **no** `0x` address in the summary; A still gated.
- [ ] User B **declines** → both still gated; either can send another request.
- [ ] User A requests again → B **accepts** → B’s grant appears → A auto-sends reciprocal grant → **both** unlock **Send** / **Request**.
- [ ] Optional: after a profile publish, Kind 0 JSON on relays has **no** `evm_address` field.

## A. Wallet bar & balances

- [ ] Open the DM → open **Wallet** from the chat header → sidebar shows peer + **Balance**.
- [ ] **Refresh** loads per-network rows (Ethereum / Arbitrum / Sepolia / Local Anvil) without a hard error; if Anvil is not running its row shows "Anvil not detected" while other enabled chains still load.
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

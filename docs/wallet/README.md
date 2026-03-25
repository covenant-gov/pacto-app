# Wallet (embedded EVM) — developer docs

Parent index: **[`docs/README.md`](../README.md)** (Nostr, MLS, storage layout, build).

These files are **tracked in git** and are intended for references from **source comments** and **user-facing strings** (e.g. error hints). Paths are stable on GitHub.

| Document | Summary |
|----------|---------|
| [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md) | JSON schema for DM `wallet_tx_request` / `wallet_tx_announcement`. |
| [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md) | RPC env vars; viem read-only vs Rust send. |
| [USD_PRICING.md](./USD_PRICING.md) | Chainlink feeds; backend pricing / env. |
| [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md) | Post transfer announcements only after successful receipt. |
| [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) | Single source: `wallet-assets.json` + Rust `wallet_chain_config`; RPC env vars. |
| [MANUAL_E2E_CHECKLIST.md](./MANUAL_E2E_CHECKLIST.md) | Manual QA: Sepolia send/request/announcement/explorer verification. |
| [EVM_ADDRESS_DERIVATION.md](./EVM_ADDRESS_DERIVATION.md) | Canonical address = MetaMask; legacy 0x04 hash bug + auto-repair. |
| [ONCHAIN_READ_PATTERN.md](./ONCHAIN_READ_PATTERN.md) | Shared pattern: persist / hydrate / background refresh / stale-while-revalidate for WalletBar + Safe-style hub reads. |

**Maintainers — alpha-only migrations (remove before beta / public v1):** WalletBar token-dropdown → watched-token list — [`docs/legacy-fixes/LF-002-wallet-bar-token-filter-migration.md`](../legacy-fixes/LF-002-wallet-bar-token-filter-migration.md). EVM address repair — [`docs/legacy-fixes/LF-001-evm-address-repair.md`](../legacy-fixes/LF-001-evm-address-repair.md). Full catalog: [`docs/legacy-fixes/CATALOG.md`](../legacy-fixes/CATALOG.md).

Supplementary product notes or checklists may be maintained separately and are not required for builds.

**Dev:** With `vite` dev mode, the wallet sidebar shows **Post test announcement (dev)** — sends a valid `wallet_tx_announcement` JSON with a fake hash so `WalletTxAnnouncementCard` can be checked in-thread before real sends.

**Desktop (Tauri):** `get_wallet_summary` and `wallet_build_and_send_transaction` are registered commands; TypeScript helpers live in `src/lib/wallet/backend-wallet.ts`. The wallet sidebar loads summary on open; **Send → Confirm** calls the backend (peer needs `profiles.evm_address` / Nostr `evm_address`). After a **confirmed** receipt, the client posts a **`wallet_tx_announcement`** DM (`formatWalletTxAnnouncement` in `dm-messages.ts`, delivered through the same path as normal DM send). **Request** in the wallet bar posts a **`wallet_tx_request`** JSON DM via `formatWalletTxRequest` and the same send path. Accepting a request opens the send form pre-filled and includes **`request_id`** on the announcement when present.

**Balance cache:** The last successful **`get_wallet_summary`** response is stored per account as **`pacto_wallet_summary_cache_v1_<npub>`** (includes a fingerprint of the watched-token list). It is read into memory in **`loadAccountState`** and shown immediately when the WalletBar refreshes if the list still matches; see **`src/lib/wallet/wallet-summary-cache.ts`**. Cleared with other npub-scoped keys on logout (`clearAccountState`).

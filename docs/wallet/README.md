# Wallet (embedded EVM) — developer docs

Parent index: **[`docs/README.md`](../README.md)** (Nostr, MLS, storage layout, build).

These files are **tracked in git** and are intended for references from **source comments** and **user-facing strings** (e.g. error hints). Paths are stable on GitHub.

| Document | Summary |
|----------|---------|
| [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md) | JSON schema for DM peer-info exchange + `wallet_tx_*` cards. |
| [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md) | RPC env vars; viem read-only vs Rust send. |
| [RPC_ISSUE_INDEX.md](./RPC_ISSUE_INDEX.md) | Tracker map: RPC errors, 429s, custom/public URLs, Alchemy vs Pimlico. |
| [USD_PRICING.md](./USD_PRICING.md) | Chainlink feeds; backend pricing / env. |
| [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md) | Non-blocking on-chain UX; optimistic DM wallet announcements. |
| [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) | Single source: `wallet-assets.json` + Rust `wallet_chain_config`; RPC env vars. |
| [PACTO-APP-LOCAL-CHAIN-SETUP.md](./PACTO-APP-LOCAL-CHAIN-SETUP.md) | How to use the local Anvil / Nostr dev stack and how it is gated out of production. |
| [MANUAL_E2E_CHECKLIST.md](./MANUAL_E2E_CHECKLIST.md) | Manual QA: Sepolia send/request/announcement/explorer verification. |
| [HD_DERIVATION_V1.md](./HD_DERIVATION_V1.md) | BIP-44 path, address hash rule, legacy cutover, golden vector. |
| [ONCHAIN_READ_PATTERN.md](./ONCHAIN_READ_PATTERN.md) | Shared pattern: persist / hydrate / background refresh for WalletBar + Safe-style reads. |
| [PACTO_GOV.md](./PACTO_GOV.md) | Upstream [covenant-gov/pacto-gov](https://github.com/covenant-gov/pacto-gov); Alloy bindings and env deploy addresses. |
| [../governance/ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md) | Roster ↔ Hats / Squad Admin **ACL**: capabilities, packed-privilege enforceability (chain recognition vs MLS-only), fail-closed signing preflight, UI snapshot. |
| [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) | Upstream [covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor); deploy, summary read, `squad_infra`. |
| [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) | Normative ERC-4337 / EIP-7702 transport spec (policy, lanes, Pimlico fees, pipeline); L0–L4; Sepolia fund matrix. |
| [SPONSORED_USEROP_SEPOLIA_EXAMPLE.md](./SPONSORED_USEROP_SEPOLIA_EXAMPLE.md) | Walkthrough of one Sepolia squad-sponsor UserOp (nesting + gas settlement Mermaid; Etherscan tabs). |
| [PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md) | Tracked JSON: sponsor / gov / Safe deploy addresses per network (`pacto-protocol-addresses.json`). |
| [USERNAME_NFT.md](./USERNAME_NFT.md) | Username NFT claim/rotation: bootstrap → EOA → global member; kind 31337; Tauri commands. |
| [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) | **Single** Sepolia operator checklist: squad sponsor, gov, Safe, announce sync, advanced, allowlist, inbox/roster, Username NFT (§10). |
| [SETTINGS_LAYOUT.md](./SETTINGS_LAYOUT.md) | Profile (identity + light wallet) vs Settings (relays, chains, RPC, Advanced, backup). |

**Maintainers — alpha-only migrations (remove before beta / public v1):** WalletBar token-dropdown → watched-token list — [`docs/legacy-fixes/LF-002-wallet-bar-token-filter-migration.md`](../legacy-fixes/LF-002-wallet-bar-token-filter-migration.md). EVM address repair — [`docs/legacy-fixes/LF-001-evm-address-repair.md`](../legacy-fixes/LF-001-evm-address-repair.md). Full catalog: [`docs/legacy-fixes/CATALOG.md`](../legacy-fixes/CATALOG.md).

**Dev:** With `vite` dev mode, the wallet sidebar shows **Post test announcement (dev)** — sends a valid `wallet_tx_announcement` JSON with a fake hash so `WalletTxAnnouncementCard` can be checked in-thread before real sends.

**Desktop (Tauri):** `get_wallet_summary` and `wallet_build_and_send_transaction` are registered commands; TypeScript helpers live in `src/lib/wallet/backend-wallet.ts`. Optional `address` on the summary is a squad-purpose key on this account. The DM wallet and prefetch pass the **primary account** (signer and receive address). Sends default to **broadcast-only** (`waitForConfirmation: false`); receipt polling is background via `wallet_wait_for_transaction` and `src/lib/evm/on-chain-background.ts` — see [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md). **Request** is always available and posts `wallet_tx_request` with `from_evm_address` set to the primary account. **Send** needs a destination: `dm_peer_evm` after one `wallet_peer_info_*` exchange, or the request’s `from_evm_address` via `to_address_evm` when paying a request. A raw `0x` from Profile Send also passes `to_address_evm`. After a transfer either way, the client stores the counterparty’s address in `dm_peer_evm`. It does not push a new primary to existing peers. After broadcast from a DM send, the client appends an optimistic `wallet_tx_announcement` (including `to_evm_address` when known), then relays the confirmed payload when the receipt succeeds (`finalizeWalletDmTransferAfterBroadcast` in `wallet-dm-transfer.ts`). Kind 0 profile metadata does **not** carry an EVM address.

Accepting a request opens the send form pre-filled to that request’s receive address and may attach `request_id` on the announcement when present.

**Balance cache:** The last successful `get_wallet_summary` response is stored per account as `pacto_wallet_summary_cache_v3_<npub>` (watched-token fingerprint plus the primary address). It is read into memory in `loadAccountState` (`src/stores/persistence.ts`) and shown when the WalletBar refreshes if both still match; see `src/lib/wallet/wallet-summary-cache.ts`. Cleared with other npub-scoped keys on logout (`clearAccountState`).

### Squad vs Advanced keys

- **Squad accounts** (`purpose: squad`): DM WalletBar Send, squad roster shares, treasury deploy, and governance commands. Only a squad-purpose key may be the primary account (signer and receive address). Squad-scoped gov / Squad Admin / tracked-token writes require a **roster binding** for the parent and pass **ACL** (access control) preflight ([ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md)).
- **Advanced accounts** (`purpose: advanced`): imported or derived advanced-only addresses. No Settings UI; backend **`evm_send_advanced_contract_call`** still refuses squad signers, and squad paths refuse advanced addresses.
- **Generic reads** (token/module observation): viem via **`src/lib/evm/read-plane.ts`** — no private key. Does not replace curated pacto-gov dashboard reads in Rust.
- **Squad allowlisted calls:** Backend + MLS ingest remain (`evm_send_squad_allowlisted_contract_call`, `squad_contract_allowlist_updated`). Settings no longer exposes allowlist or arbitrary contract-call UI.
- Operator smoke: [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md).

# ISSUE 03 — DM WalletBar: EVM / Aztec mode, peer transfers, Fee Juice (**WIP**)

## Status

**Work in progress.** Detailed scope, wire formats, and error codes should be **filled in after ISSUE 01 (sidecar)** and **ISSUE 02 (keys + encrypted persistence)** are implemented and stabilized. This document captures direction only.

## Goal

Extend the **DM view wallet sidebar** (the panel next to the active conversation) so users can switch between **EVM** and **Aztec** modes and perform **simple peer-to-peer transfers**, consistent with existing WalletBar patterns (balances, send, request, toasts, accessibility).

## UX

1. **Mode switch**: **EVM / Aztec** toggle or segmented control in the DM wallet chrome.
   - Styling should follow **existing theme tokens** (`app.css`, semantic colors, borders) so light/dark and accent behavior match the rest of the app — avoid one-off colors that only work in one theme.
2. **Parity where sensible**: network/chain selection, balance loading, send modal flow, loading and error states should mirror EVM ergonomics documented under `docs/wallet/`.

## Product and protocol prerequisites

1. **Fee Juice**: Aztec transactions require **Fee Juice** (L2 fee token). The UI must surface when the user **cannot** send due to insufficient Fee Juice and point to acquisition paths (e.g. [Aztec Faucet](https://aztec-faucet.nethermind.io/) / in-app copy TBD).
2. **Peer resolution**: Recipients need a resolvable Aztec identity or address from the DM context (analog to EVM `dm_peer_*` flows). Exact schema may mirror `docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md` patterns or extend them — **decision deferred** until after ISSUE 02.

## Technical dependencies

- **ISSUE 01**: long-lived or on-demand sidecar + Rust `invoke` commands for prove/send pipeline.
- **ISSUE 02**: encrypted key material, PIN/session gating, Settings initialization so DM flows can assume an Aztec account exists.

## Out of scope (initial pass)

- Full governance or complex Aztec contract interactions (see stakeholder [embedded-wallet-plan.md](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md)).
- Final DM announcement/request payload design for Aztec (**TBD** with privacy review).

## Completion checklist (to refine after 01 + 02)

- [ ] EVM/Aztec mode switch in DM WalletBar with theme-consistent styling.
- [ ] Balance read path for Aztec via Tauri command + sidecar.
- [ ] Send flow: validate amount, recipient, Fee Juice; show progress for long proving steps.
- [ ] Structured errors compatible with frontend parsing (align with EVM patterns).
- [ ] Manual E2E: two users or two accounts, DM context, successful Aztec transfer on target network.
- [ ] Update `docs/wallet/` with Aztec chain/RPC notes when stable.

## References

- [embedded-wallet-plan.md](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md)
- `docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`, `docs/wallet/README.md`

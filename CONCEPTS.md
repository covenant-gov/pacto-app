---
name: Pacto Concepts
last_updated: 2026-07-07
---

# Pacto Concepts

A shared vocabulary for humans and coding agents working on Pacto. Terms are ordered from identity outward.

## Identity

| Term | Definition |
|------|------------|
| **npub** | Nostr public key. The user's human-readable identifier and the root of trust. |
| **nsec** | Nostr secret key. Stored encrypted; never exposed to the frontend or network. |
| **BIP-39 seed** | The same mnemonic seed that derives the Nostr keypair and the embedded EVM wallet. See `docs/wallet/HD_DERIVATION_V1.md`. |
| **squad key** | A phrase-derived EVM account whose purpose is `squad`. Used for treasury, governance, and roster-bound actions. |
| **advanced key** | A phrase-derived or imported EVM account whose purpose is `advanced`. Restricted to the Settings → Advanced contract-call panel. |

## Messaging

| Term | Definition |
|------|------------|
| **DM** | Direct message. End-to-end encrypted NIP-17/NIP-59 Gift Wrap (kind 1059) addressed to a peer's npub. |
| **Rumor** | The inner, decrypted Nostr event after a Gift Wrap is opened. Kinds include 14 (text), 15 (file), 7 (reaction), 30078 (typing), and structured application rumors. |
| **MLS** | Messaging Layer Security. The open protocol used for private group messaging; implemented via the `mdk` engine. |
| **Squad** | A private community hub — a group of people sharing MLS channels and optionally a treasury. Stable id = announcements MLS group id. |
| **Network** | An inter-organizational hub — a "Squad of Squads" — for cross-group coordination. |
| **Squad-pair** | Partner coordination link between two anchor squads. Uses the same announcements-group-id rule as squads. See `docs/communities/DESIGN.md`. |
| **Channel** | A chat stream inside a Squad or Network. Each channel is backed by an MLS group id. |
| **Announcements** | The first channel of every squad/network. Its MLS group id is the parent's stable identifier. |
| **Commons** | Public discovery feed for squads and time-bounded broadcasts; top-level navigation. |
| **Gift Wrap** | NIP-59 outer envelope (kind 1059). Hides sender, recipient, and metadata from relays. |
| **MlsWelcome / kind 443** | MLS group invitation payload delivered inside a Gift Wrap. |
| **MlsGroupMessage / kind 444** | MLS-encrypted group traffic on the wire; `h` tag = wire group id. |

## Governance and finance

| Term | Definition |
|------|------------|
| **pacto-gov** | Upstream governance contract library for modular voting and decision rules. See `docs/wallet/PACTO_GOV.md`. |
| **pacto-squad-sponsor** | Upstream factory for deploying squad infrastructure (treasury, governance, hats). See `docs/wallet/PACTO_SQUAD_SPONSOR.md`. |
| **Squad infra** | On-chain artifacts deployed for a squad: Safe treasury, governance module, and Hats tree. Persisted in SQLite (`squad_infra`). |
| **Safe** | Gnosis Safe multi-signature contract used as the squad treasury. |
| **Hats Protocol** | On-chain role management. Hats define roles that can be granted, revoked, and checked by contracts. |
| **Proposal** | A pacto-gov governance action (spend, role change, etc.) voted on by squad members. |
| **WalletBar** | The in-thread wallet UI for sending tokens, requesting payments, and announcing transactions. |

## Architecture

| Term | Definition |
|------|------------|
| **Tauri v2** | Desktop app framework: Svelte frontend in a webview, Rust backend. |
| **invoke** | Frontend -> backend typed RPC via `tauri-apps/api/core`. |
| **emit** | Backend -> frontend event pushed through `AppHandle::emit`. |
| **per-account SQLite** | Two databases per npub: `vector.db` (app data) and `vector-mls.db` (engine state). |
| **read-plane** | Frontend viem read-only chain access: balances, contract observation, receipt polling. |
| **Rust send** | WalletBar and governance writes are signed and broadcast from the Rust backend using Alloy. |
| **Greenfield** | Repo posture: no public alpha shipped yet; prefer breaking, minimal paths over compatibility shims. |

## See also

- `docs/README.md` — authoritative docs index
- `STRATEGY.md` — why these concepts matter and what the product is trying to achieve
- `docs/ARCHITECTURE.md` — how the concepts connect in code

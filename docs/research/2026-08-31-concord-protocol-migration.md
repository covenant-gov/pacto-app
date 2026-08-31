# Concord Protocol Migration — Research

Evaluates replacing Pacto's Nostr MLS group messaging (`mdk`/OpenMLS) with
[Concord Protocol](https://concordprotocol.org) for Squad/channel messaging.

## What Concord actually is

Not a library to drop in — a competing **protocol specification** (CORD-01
through CORD-08) for Discord-style communities over Nostr, currently
implemented by two clients (Vector, Armada), neither of which is Pacto. Core
model:

| | Pacto today (MLS/mdk) | Concord |
|---|---|---|
| Group crypto | OpenMLS ratchet tree, per-message forward secrecy, `mdk_core` engine (SQLite-backed MLS provider, ~26 tables) | Symmetric `group_key()` HKDF derivation per epoch; **no per-message ratchet** — explicitly traded away for scalability (their own doc: "forward secrecy is not ratcheted") |
| Membership | MLS commits/welcomes, cryptographic group state, add/remove via MLS ops | "Membership is key possession" — a shared `community_root`; join = receive key via invite; remove = rotate key (Refounding) and hope old holders don't retain copies |
| Authority/roles | Pacto's own roster + `access_control` module gating EVM actions (Hats/Safe), independent of MLS | CORD-04: signed, owner-rooted role grants folded client-side; enforcement is rejection, not prevention |
| Governance linkage | `governance_updated`, `squad_safe_updated`, `squad_member_evm_share` announced as MLS application messages, ingested by `db.rs` virtual-bucket logic tied to `mls_group_id` | No concept of this — Concord has no EVM/governance semantics at all |
| Ownership recovery | N/A (Pacto's own model) | **No succession.** Lost owner key = unrecoverable community. Dissolution is the only clean exit |
| Maturity | Vendored via `mdk` crate (nostr-mls ecosystem), used in production-track code | Two client implementations, spec still evolving ("legacy epochs" migration language already present in CORD-02 — the protocol itself has already had a breaking change) |

## Scope of what's actually coupled to MLS in Pacto

MLS is not an isolated messaging backend in this codebase — it's load-bearing
for governance:

- `src-tauri/src/mls.rs` — 4,664 lines (group create/invite/welcome/commit/eviction/reaper)
- `mls_orphan_reaper.rs`, `mls_store_reset.rs`, `mls_legacy_checksum.rs`, `join_inbox.rs`, `harness.rs`, `nostr_sign.rs`, `lib.rs` all touch `mdk`/MLS types directly (11 files)
- `db.rs`: `maybe_upsert_governance_from_announce`, `apply_mls_virtual_bucket_side_effects` — governance, treasury, and roster-EVM state are ingested **from MLS application messages inside the squad's announcements group**
- `dashboard_poll.rs`: polls are created/voted by sending MLS messages (`send_mls_message`) to the squad's announcements group
- Separate `mls_migrations/` schema (own refinery-style migration set, ~10+ files) for the `mdk` SQLite provider (group state, ratchet secrets, proposals, exporter secrets)
- Frontend: `tauri-subscriptions.ts` listens for `mls_message_new`, `mls_group_initial_sync`; every Squad UI surface (chat, announcements, roster, polls, sticker packs) assumes an MLS group id as the addressing unit

This is not "swap the messaging transport." Squad = MLS group is the
substrate that governance, treasury, roster/access-control, polls, and
sticker packs are all announced over.

## Effort estimate

| Phase | Work | Rough size |
|---|---|---|
| Protocol layer | Implement CORD-01..08 in Rust from spec (streams, epochs, Control/Chat/Guestbook planes, roles, invites, rekeys/refoundings, A/V, disappearing messages) — no existing Rust crate to vendor | 8,000–12,000+ LOC net-new, comparable to or larger than current `mls.rs` + `mls_migrations` combined |
| Data model | New SQLite schema for community/channel/role/epoch state; migrate `squad_catalog`, `chat.rs` `ChatType`, `db.rs` governance ingestion off `mls_group_id` addressing onto Concord's `channel_pk`/epoch addressing | Touches `chat.rs`, `db.rs`, `dashboard_poll.rs`, `catch_up.rs`, `squad_catalog`, migrations |
| Governance re-plumbing | Concord has no announce/ingest concept — `governance_updated`, `squad_safe_updated`, roster EVM shares need a new home (likely: Concord Chat Plane as transport, Pacto-specific parsing layer rebuilt on top) | New design work, not just porting |
| Frontend | Replace `mls_message_new`/`mls_group_initial_sync` event contracts, squad chat UI, roster UI (Concord Roles vs Pacto's access_control) | Multiple components in `src/components/channel/`, `parent/`, `squad/` |
| Dual-running / cutover tooling | Given "no succession" and no interop between MLS groups and Concord communities, every existing Squad needs a **new community**, not an in-place upgrade | Migration tooling, or accept full reset |

Realistic estimate for a working parity implementation (not counting audit,
hardening, or the calls/A-V spec CORD-07): **3–5 months of focused backend +
frontend engineering** for a small team, assuming no upstream Rust
implementation of Concord appears to vendor. If a maintained `concord-rs`
crate materializes (none exists today per the GitHub org), cut this
significantly — but that's a bet, not a plan.

## Backward compatibility

**None, by design.** Concord communities and MLS groups are
cryptographically and structurally unrelated:

- No shared identifiers, no shared invite format, no migration path for existing Squad members.
- Concord's own doc: "there is no succession" — a lost owner key kills a community permanently. Pacto's Squad ownership model (tied to on-chain roster/Hats) would need to independently re-derive Concord ownership, since Concord ownership is `sha256(owner_xonly || salt)`, not linked to any EVM role.
- Existing MLS message history stays readable locally (Pacto's own DB) but has no path into a Concord community — it would be a one-time export/archive, not a live migration.
- Every Squad's `mls_groups` row, roster, and announcement history is orphaned; every member needs a fresh invite into a newly-founded Concord community.

## Impact to users

- Every existing Squad chat history effectively ends. No live migration; at best "read-only archive of old MLS chat" + "new Concord community, rejoin required."
- Every user must accept new invites for every Squad/channel they're in — no bulk migration since Concord membership = key possession via invite, not an admin-pushed conversion.
- Weaker forward secrecy than what Pacto ships today (MLS ratchet) — a security *downgrade* for chat, which cuts against Pacto's stated threat model (`docs/audits/README.md` already flags wallet code as alpha-grade; adding a weaker-crypto messaging layer compounds that).
- Squad owners face unrecoverable-key risk with no MLS-style membership-commit safety net — losing the owner Nostr key permanently kills the Squad (worse than current model where Pacto's own EVM roster provides recovery paths).
- Positive: Concord's Guestbook/Roles model is closer to "Discord-style" UX (roles, kicks, bans as first-class objects) than raw MLS commits — could simplify some access-control UI *if* Pacto's EVM-gated capability model didn't already provide that.

## Timeline (if pursued)

1. **Spec freeze risk check** (1–2 weeks): Concord's spec already documents "legacy epochs" from a breaking mid-spec change (control-plane key split). Confirm spec stability with upstream before committing — building against a moving target is the single biggest risk here.
2. **Prototype CORD-01/02 in Rust** (3–4 weeks): streams, addressing, epochs — validate feasibility and dependency footprint (needs NIP-44, NIP-59, secp256k1/schnorr — likely already available via `nostr-sdk`/`alloy`, reducing this).
3. **Full protocol + governance re-plumbing** (8–12 weeks): CORD-03..08, migrate `db.rs`/`dashboard_poll.rs`/`chat.rs`, new schema, frontend event contracts.
4. **Migration tooling + user comms** (2–3 weeks): archive old MLS history, invite-regeneration flow for every Squad.
5. **Security review** (2–4 weeks): mandatory given greenfield/alpha posture and the forward-secrecy downgrade.

**Total: ~4–6 months**, contingent on Concord's spec being frozen (not yet
fully evidenced) and no upstream Rust crate.

## Recommendation

Don't switch wholesale. Concord solves a problem Pacto doesn't clearly have
(Pacto already has no central server via relays + MLS) while introducing:

- a security regression (no per-message ratchet),
- an unrecoverable-owner-key failure mode,
- zero backward compatibility (total Squad reset for every user),
- and a large governance-replumbing bill, since Concord has no concept of EVM-gated announces.

If there's a specific motivating pain point (e.g., MLS commit/welcome
flakiness, `mdk` maintenance burden, or wanting Discord-style role UX),
that's worth stating explicitly — it may be solvable by improving the
existing MLS layer or by adopting *specific* Concord ideas (e.g., their
Guestbook/Roles model as a UX pattern layered on existing MLS groups) rather
than a protocol swap.

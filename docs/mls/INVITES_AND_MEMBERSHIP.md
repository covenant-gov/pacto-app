# MLS — invites and joining groups

How **Welcomes** (Kind **443**) move over **Gift Wraps (1059)** and how the app exposes **pending invites**, **resend**, and **accept**.

**Implementation:** `src-tauri/src/mls.rs`, orphan cleanup in `src-tauri/src/mls_orphan_reaper.rs`, Gift Wrap path in `src-tauri/src/lib.rs`, commands registered in `lib.rs`.

---

## 1. Two ways to add someone

| Path | Command / flow |
|------|----------------|
| **New group with members** | `create_group_chat` / `create_mls_group` — `engine.create_group` commits the group into the local MDK store first; group metadata (`mls_groups`) and the STATE chat are persisted next; **only then** are Welcomes gift-wrapped 1:1 via **`gift_wrap_to(trusted_relays::trusted_relays(), target_pubkey, welcome, …)`**. A delivery failure no longer aborts the create — it returns `Ok` with `GroupCreateOutcome.pending_invites`, and those npubs are recorded in the group's `pending_welcomes` column. |
| **Invite to existing group** | `invite_member_to_group` → refresh **KeyPackages** → `add_member_device` → engine **`add_members`** → publish **commit**; send Welcomes via Gift Wrap; **merge pending commit** locally |

Relays: Welcomes use the resolved **`trusted_relays::trusted_relays()`** set (not arbitrary relay lists).

---

## 2. Receiving an invite

1. Invitee must subscribe to **Gift Wraps** addressed to them (sync + live).
2. Unwrap; if inner kind is **`MlsWelcome`**: run **`engine.process_welcome`** on a **blocking thread** (MDK is not `Send`).
3. On success, emit **`mls_invite_received`** (often gated so the UI is not spammed during bulk sync) with e.g. **`wrapper_event_id`**.

---

## 3. Listing and accepting

| Command | Role |
|---------|------|
| **`list_pending_mls_welcomes`** | Returns **`SimpleWelcome`** rows: use **`id`** (inner welcome event id) for accept |
| **`accept_mls_welcome(welcome_event_id_hex)`** | Pass **`SimpleWelcome.id`**, **not** `wrapper_event_id` |

**Accept flow (high level):** `get_welcome` → `accept_welcome` → resolve engine vs wire group ids → persist **`mls_groups`** / clear **evicted** if re-invite → **`create_or_get_mls_group_chat`** → save chat.

---

## 4. Undelivered invites and resend

Persist-before-delivery is deliberate: by the time `create_group` reaches the Welcome loop, `engine.create_group` has already committed the group (and its epoch-1 commit) into the local MDK store. Aborting on a delivery failure would leave that commit behind with no `mls_groups` row, no chat, and no UI presence — an orphan the user can't see or retry. Persisting metadata + chat first, then attempting delivery, turns a failure into a visible **pending invite** on a real group instead.

| Piece | Shape |
|-------|-------|
| **`pending_welcomes`** | JSON array of npubs on the group's `mls_groups` row — the recovery handle |
| **`UndeliveredInvite { npub, reason }`** | Wire shape inside `GroupCreateOutcome.pending_invites` |
| **UI** | Members panel shows a pending badge per undelivered npub, plus a **Resend invite** action for admins |

**Resend mechanics:** a pending member already has an MLS leaf — the engine-side add succeeded, only delivery failed — so recovery is necessarily **remove-then-re-add**. `add_member_device` resolves this to `MembershipAction::Restore`, which mints a fresh Welcome at the group's **current** epoch. Replaying the original epoch-1 Welcome is deliberately not the mechanism: it would be unusable once the group has advanced past epoch 1, and persisting raw welcome rumors would add a new at-rest store of group secrets for no benefit.

A resend skips the store-reset KeyPackage-freshness gate (`resolve_fresh_keypackage` / `keypackage_generation_advanced`) that a genuine "Restore access" call still applies. That gate exists to reject a stale, pre-reset KeyPackage after a member wiped and re-created their MLS store — but a pending member never reset anything, so gating a resend on rotation would reject it forever. Resend still **fetches the latest** KeyPackage: the one recorded at create may already have been consumed.

**Squad layer (consent-first):** Creating a squad builds a **creator-only** announcements MLS group (`create_group_chat` with empty `member_ids`). Selected contacts are invited afterward via `sendConsentFirstSquadInvite` (`inviteId` + `admitterNpubs` + `squad_outbound_invite` announce + DM). MLS-add runs only after the invitee Accepts (admit pipeline). The Join inbox Nostr identity is never an MLS leaf.

**Resend:** After admit, if Welcome delivery fails, Members shows a pending badge. **Resend invite** remove-then-re-adds (Restore) and sends a fresh consent-first DM so Accept still works if the Welcome is late. Channel create still sends the under-the-hood `channel_in_squad` notify to selected members.

**Partial-failure state:** if a resend's remove commits but the re-add fails, the member ends up outside the group while still flagged pending in `pending_welcomes`; the panel keeps them visible so the admin can retry rather than silently dropping them.

---

## 5. Orphan reaper

`src-tauri/src/mls_orphan_reaper.rs` deletes local MDK engine groups that have no matching `mls_groups` row — state a prior release's abort-on-delivery-failure path could leave behind (engine commit landed, metadata never did). `engine.delete_group` is local-only, so reaping has no protocol side effects.

`MLS_GROUPS_ENGINE_CREATE_LOCK` serializes the reap sweep against `create_group`'s engine-commit-then-first-persist window **and** `do_accept_mls_welcome`'s accept-then-persist window, so a just-created or just-joined group is never mistaken for an orphan mid-write. The reaper runs from `sync_mls_groups_now`'s sync-all branch (startup, relay reconnect) with a cooldown between passes, refuses to delete anything when the metadata table reads empty while the engine store is not (that's a broken read, not real orphans), and matches engine/metadata hex ids case-insensitively.

---

## 6. Frontend hooks

| Event | Use |
|-------|-----|
| **`mls_invite_received`** | Refresh pending invites list |
| **`mls_group_initial_sync`** | Creator after group create |
| **`mls_group_updated`** | Member list / metadata changed |
| **`mls_group_metadata`** | Group metadata (including `pending_welcomes`) changed; payload is `{ metadata: { group_id, ... } }` |

**Squad / product layer:** Pacto may also send a **DM** with a structured **`squad_invite`** (or similar) payload so the UI can show an invite card; Accept should still call **`accept_mls_welcome`** with the pending welcome **`id`** matching the **`groupId`** in the card. Grep `squad_invite` / `formatSquadInvite` in `src/` for the current shape.

---

## 7. Operational constraints

- **KeyPackages:** Inviting requires a published **KeyPackage** for the invitee's device; a missing KeyPackage still fails the invite outright with a "no keypackages" style error.
- **Delivery:** A Welcome gift-wrap failure after the engine commit no longer fails the invite; it degrades to a **pending invite** (see "Undelivered invites and resend" above) instead.
- **Privacy:** Welcome plaintext is only visible to the invitee; other members see the **commit** updating the tree.

---

*Condensed from internal MLS invite flow notes.*

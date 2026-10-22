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

**A wiped install** cannot open old welcomes: the KeyPackage private key died with `pacto-mls.db`. Recovery is admin-driven and sender-bound:

- **Eligibility:** After DM backfill the client plans a rejoin only for **received, undeclined** `squad_invite` DMs whose message id is in the persisted accepted-invite list, for groups it has not joined. When local state is gone too (no accept record), the recovered invite card offers **Already a member? Request restore**, which plans that one squad on user action. Targets are the invite's `admitterNpubs` (capped at 3) plus the DM peer.
- **Request:** `squad_rejoin_request` goes by DM to **one target per attempt**, rotating, with exponential backoff (45s doubling, capped at 6h), an attempt cap of 64 (about 14 days of continuous running), and a **14-day** TTL from creation. A send that throws re-arms the backoff but does **not** spend an attempt, so an offline or relay-starved client cannot exhaust its budget against requests nobody received. Attempts count only while the app runs. An expired request is kept as a **tombstone** so a kicked, departed, or long-gone member does not DM admitters on every launch; tombstones are capped separately from live rows, because evicting one resurrects its request.
- **Scheduling:** The retry timer wakes at the earliest moment a request is actually due (or at the TTL that tombstones it), not on a fixed interval. Channel-phase rows schedule nothing: later welcomes arrive on `mls_invite_received`. A row whose restored channels are all in is dropped after a 10-minute grace for the admin's per-channel DMs, rather than idling for the full 24-hour window.
- **After expiry:** Automatic retries stop and the member's client no longer auto-accepts that squad's welcome. An admin can still run **Restore access** on the announcements members panel at any time; the welcome then appears as a normal pending welcome the member accepts by hand. The invite card's **Request restore** link starts a fresh request, but it renders only while the invite is pending, so a member whose invite is recorded as accepted has no in-app way to restart an expired request (known gap).
- **Admin:** The receiving device acts only if the DM **sender equals `requester_npub`**, it is an MLS admin of the announcements group (`admin_pubkeys`), and the requester still has a leaf; a requester with no leaf is ignored, so a kick is not undone. It runs squad-level restore (remove the stale leaf and add a fresh welcome for announcements; for every other channel where that npub still has a leaf and this device admins; for open channels they are missing) and sends a `channel_in_squad` DM per restored channel. A restore for the same squad and requester is deduped for 10 minutes, and a sender whose ask was **rejected** waits 30 seconds before the device spends another MLS member read on them. There is no relay: if no admitter is online the request waits for the next retry.
- **Auto-accept:** The wiped client accepts only welcomes whose `welcomer` is a request target, or the welcomer that restored announcements for that squad's channel welcomes. After announcements join, the row stays in a 24-hour channel window so later channel welcomes are accepted. Old channel messages stay unreadable.
- **Members panel:** **Restore access** on the **announcements** members panel runs the squad-wide restore above; on a channel's panel it restores only that channel (channel admins who are not announcements admins cannot restore the squad). Every successful re-add bumps the group's membership version and refetches its member list, so the open panel repaints. A restore that is already in flight or inside its 60-second cooldown returns a skipped status and the panel shows an "already in progress" toast instead of a success toast; those cooldowns are cleared on logout or account switch.

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

# MLS — invites and joining groups

How **Welcomes** (Kind **443**) move over **Gift Wraps (1059)** and how the app exposes **pending invites** and **accept**.

**Implementation:** `src-tauri/src/mls.rs`, Gift Wrap path in `src-tauri/src/lib.rs`, commands registered in `lib.rs`.

---

## 1. Two ways to add someone

| Path | Command / flow |
|------|----------------|
| **New group with members** | `create_group_chat` / `create_mls_group` — engine returns one **Welcome** per initial member; each sent with **`gift_wrap_to(TRUSTED_RELAYS, target_pubkey, welcome, …)`** |
| **Invite to existing group** | `invite_member_to_group` → refresh **KeyPackages** → `add_member_device` → engine **`add_members`** → publish **commit**; send Welcomes via Gift Wrap; **merge pending commit** locally |

Relays: Welcomes use **`TRUSTED_RELAYS`** (not arbitrary relay lists).

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

## 4. Frontend hooks

| Event | Use |
|-------|-----|
| **`mls_invite_received`** | Refresh pending invites list |
| **`mls_group_initial_sync`** | Creator after group create |
| **`mls_group_updated`** | Member list / metadata changed |

**Squad / product layer:** Pacto may also send a **DM** with a structured **`squad_invite`** (or similar) payload so the UI can show an invite card; Accept should still call **`accept_mls_welcome`** with the pending welcome **`id`** matching the **`groupId`** in the card. Grep `squad_invite` / `formatSquadInvite` in `src/` for the current shape.

---

## 5. Operational constraints

- **KeyPackages:** Inviting requires a published **KeyPackage** for the invitee’s device; otherwise invite fails with a “no keypackages” style error.
- **Privacy:** Welcome plaintext is only visible to the invitee; other members see the **commit** updating the tree.

---

*Condensed from internal MLS invite flow notes.*

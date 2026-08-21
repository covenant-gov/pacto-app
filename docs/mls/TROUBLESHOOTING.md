# MLS troubleshooting — missing KeyPackages and undelivered welcomes

## Symptom

- Creating a squad or other MLS-backed group fails or omits members; logs may show:
  - `No device keypackages found for npub1…`
  - `[MLS][create_group_chat] Skipping member with no device keypackages: <npub>`
- Or the UI creates the group but **fewer members** than selected.
- Or the group is created with **all** requested members, but one shows a **pending invite** badge — the engine added them, but their Welcome gift-wrap failed to publish.

## Why MLS needs KeyPackages

Each member must have at least one published **device KeyPackage** (Nostr) so the MLS engine can add their device to the tree. If **`refresh_keypackages_for_contact`** returns **no devices** for an npub:

- They may never have run Pacto (or another client) long enough to publish a KeyPackage.
- Cached/fetched KeyPackages may be missing or expired.

## Backend behavior (`create_group_chat`)

**Command:** `create_group_chat` in `src-tauri/src/lib.rs`, engine work in `MlsService::create_group` (`src-tauri/src/mls.rs`).

For each selected `member_ids` npub, **before the engine is touched**:

1. **`refresh_keypackages_for_contact(npub)`** — on transport/refresh failure, creation **aborts** with  
   `Failed to refresh device keypackage for {npub}: {error}`.
2. If refresh succeeds but **zero** KeyPackages:
   - That npub is **skipped** (not added), returned in `GroupCreateOutcome.skipped`.
   - Log: `[MLS][create_group_chat] Skipping member with no device keypackages: <npub>`.
3. If **every** member was skipped → error:  
   `No device keypackages found for any selected member: [npub1..., …]`.
4. If **some** skipped but at least one member has KeyPackages → group is created with the valid members only; log:  
   `[MLS][create_group_chat] Proceeding without members missing keypackages: […]`.

Device choice today: **first** device returned per npub (see comment in `create_group_chat`).

Past this point, a failure no longer aborts the create. `engine.create_group` commits the group into the local MDK store, then group metadata + chat are persisted, and only then are Welcomes gift-wrapped one per invited member. A recipient whose gift-wrap fails to publish is **not** rolled back — they're already an engine member — and is returned in `GroupCreateOutcome.pending_invites` with their npub recorded in the group's `pending_welcomes` column instead of failing the whole call.

## What to tell users

**Skipped member** (never added — no usable KeyPackage):

- Use **Pacto** on at least one device, complete login / PIN setup so the app can **publish a device KeyPackage** (see also KeyPackage bootstrap after PIN in `lib.rs`).
- Retry **create group** or **`invite_member_to_group`** after they appear online with keys.

**Pending member** (already in the group — only delivery failed):

- They do not need to do anything on their device; the membership already exists in the engine.
- An admin uses the **Resend invite** action in the members panel, which removes and re-adds them (`add_member_device` with `is_resend`) to mint a fresh Welcome at the group's current epoch. Resend always fetches the member's **latest** KeyPackage (the one recorded at create may already have been consumed).
- Squad create does not send a `squad_invite` DM until that announcements-group resend succeeds. Channel create still sends the under-the-hood `channel_in_squad` notify to pending npubs — a missing welcome makes accept a no-op, and the cached DM names the channel once the resend lands.

## Related code

| Area | Location |
|------|----------|
| Group create preflight | `src-tauri/src/lib.rs` — `create_group_chat` |
| Persist-then-deliver + pending invites | `src-tauri/src/mls.rs` — `MlsService::create_group`, `MlsGroupMetadata.pending_welcomes` |
| Resend | `src-tauri/src/mls.rs` — `MlsService::add_member_device` (`is_resend`) |
| Orphan cleanup for pre-fix groups | `src-tauri/src/mls_orphan_reaper.rs` |
| KeyPackage table | `src-tauri/src/db.rs` — `mls_keypackages`, `save_mls_keypackages` |
| Full design notes | `docs/mls/INVITES_AND_MEMBERSHIP.md` |

---

*Consolidated from internal MLS debug notes (`DEBUG_MEMBER_KEY_PACKAGE`).*

# MLS troubleshooting — missing member KeyPackages

## Symptom

- Creating a squad or other MLS-backed group fails or omits members; logs may show:
  - `No device keypackages found for npub1…`
  - `[MLS][create_group_chat] Skipping member with no device keypackages: <npub>`
- Or the UI creates the group but **fewer members** than selected.

## Why MLS needs KeyPackages

Each member must have at least one published **device KeyPackage** (Nostr) so the MLS engine can add their device to the tree. If **`refresh_keypackages_for_contact`** returns **no devices** for an npub:

- They may never have run Pacto (or another client) long enough to publish a KeyPackage.
- Cached/fetched KeyPackages may be missing or expired.

## Backend behavior (`create_group_chat`)

**Command:** `create_group_chat` in `src-tauri/src/lib.rs`.

For each selected `member_ids` npub:

1. **`refresh_keypackages_for_contact(npub)`** — on transport/refresh failure, creation **aborts** with  
   `Failed to refresh device keypackage for {npub}: {error}`.
2. If refresh succeeds but **zero** KeyPackages:
   - That npub is **skipped** (not added).
   - Log: `[MLS][create_group_chat] Skipping member with no device keypackages: <npub>`.
3. If **every** member was skipped → error:  
   `No device keypackages found for any selected member: [npub1..., …]`.
4. If **some** skipped but at least one member has KeyPackages → group is created with the valid members only; log:  
   `[MLS][create_group_chat] Proceeding without members missing keypackages: […]`.

Device choice today: **first** device returned per npub (see comment in `create_group_chat`).

## What to tell users

For each npub that was skipped or blocked:

- Use **Pacto** on at least one device, complete login / PIN setup so the app can **publish a device KeyPackage** (see also KeyPackage bootstrap after PIN in `lib.rs`).
- Retry **create group** or **`invite_member_to_group`** after they appear online with keys.

## Related code

| Area | Location |
|------|----------|
| Group create preflight | `src-tauri/src/lib.rs` — `create_group_chat` |
| KeyPackage table | `src-tauri/src/db.rs` — `mls_keypackages`, `save_mls_keypackages` |
| Invites still require KP | `docs/mls/INVITES_AND_MEMBERSHIP.md` |

## Future improvements (optional)

- Structured API response: `group_id` + `skipped_members[]` instead of relying on logs + partial roster.
- UI copy next to skipped contacts explaining they need to open Pacto once.

---

*Consolidated from internal MLS debug notes (`DEBUG_MEMBER_KEY_PACKAGE`).*

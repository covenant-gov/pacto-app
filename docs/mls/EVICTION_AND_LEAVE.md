# MLS — eviction, leave, admin limits

**Engine:** MDK (`mdk_core`, `mdk_sqlite_storage`) via **`MlsService`** in `src-tauri/src/mls.rs`. **“Vector” in old notes = this stack.**

---

## 1. Kicking a member (`remove_member_device`)

- App calls the MLS engine’s **`remove_members`** with the target pubkey; **MDK enforces admin policy** — Pacto does not duplicate an admin check in Rust before the call.
- At **group creation**, config typically sets **only the creator** as admin (`NostrGroupConfigData` / `vec![my_pubkey]`). So in practice **only the creator** can remove members unless MDK group config gains more admins.

After a successful remove: evolution event published, **`merge_pending_commit`** locally, **`mls_group_updated`** for UI refresh.

**Evicted user:** There is no special DM. They learn from engine errors on next send/sync (**“own leaf not found”**, **“evicted”**, etc.).

---

## 2. Local eviction cleanup (`cleanup_evicted_group`)

When **this client** is removed, sync or live **444** handling detects eviction-like engine errors, then:

1. Set **`evicted`** on **`mls_groups`**  
2. Remove chat from **`STATE`** and **delete chat from DB**  
3. Drop **MLS event cursor** for that group  
4. Emit **`mls_group_left`**

**`list_mls_groups`** skips **evicted** groups. Re-invite + **accept** can clear **evicted** and restore the group.

---

## 3. Voluntary leave (`leave_mls_group`)

- Engine emits a **leave proposal**; Pacto publishes it, then **removes group from local metadata** for the leaver and emits **`mls_group_left`** — the group **disappears from the leaver’s list immediately**.
- **The group continues** for remaining members; MLS tree updates without the leaver.

**Admin handoff:** Pacto does **not** currently expose “add admin” / “transfer MLS admin”. Only the creator is admin at creation. If the **creator leaves**, the MLS group may end up with **no admins** → **no further kicks** from MLS until MDK + app support admin updates. Squad-level roles (e.g. Hats) are a separate product layer.

---

## 4. “Pending proposal” errors

**Symptoms:** Logs like **`Can't create message because a pending proposal exists`**, **`Unprocessable event`**.

**Cause:** MLS **proposals** must be applied in a **commit**. Until then, the engine may block **new application messages** for that group.

**Common cases:**

1. **You left:** Local metadata is gone but the **engine** may still hold the group with a pending leave proposal.  
2. **Someone else’s proposal** not yet committed.  
3. **`merge_pending_commit`** did not run after an add/remove path.

**Mitigation:** Another member commits, or engine-specific merge/discard APIs if available; restart/re-sync. Pacto merges pending commit after some operations (**`remove_member_device`**, add member) — not necessarily after every **`leave_group`**.

---

## 5. Commands / events (reference)

| Action | API |
|--------|-----|
| Kick | Tauri command → **`remove_member_device(group_id, member_pubkey, device_id)`** |
| Leave | **`leave_mls_group(group_id)`** |
| UI refresh | **`mls_group_left`**, **`mls_group_updated`**, **`list_mls_groups`** (excludes evicted) |

---

*Condensed from internal MLS eviction / leave notes.*

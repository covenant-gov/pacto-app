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

### Leaver

- Non-admin **`leave_group`** creates a **SelfRemove** proposal (MDK 0.8). Pacto **must** publish that evolution event (publish failure aborts leave so peers are not left with a ghost member), then removes the group row from **`mls_groups`**, drops chat/DB/cursors, and emits **`mls_group_left`**.
- **Admins** cannot call **`leave_group`** until they self-demote (MIP-03). Sole-admin exit without transfer is still a product gap.

### Remaining members (MDK 0.8 SelfRemove)

1. Sync or live **`process_message`** on the leave proposal returns **`MessageProcessingResult::Proposal(UpdateGroupResult)`** — MDK has **auto-committed** locally and staged a commit in **`evolution_event`**.
2. Pacto **`publish_and_merge_auto_commit`**: publish that commit → **`merge_pending_commit`** → **`sync_mls_group_participants`** → **`mls_group_updated`**.
3. The peer that successfully publishes+merges posts a structured **`squad_member_left`** application message to the same wire group (`pacto_virtual_bucket: announcements`) so `#announcements` shows a leave notice.

If publish/merge is skipped, **`get_mls_group_members`** still lists the leaver → Members, Crew, and Invite filters stay wrong.

### Legacy fallback

Older engines sometimes returned **`Unprocessable`** with failure reason **`not processing proposal from non-admin`**. Pacto still maps that to **`finalize_voluntary_leave_as_admin`** (admin **`remove_members`** + publish + merge + leave announce). SelfRemove auto-commit is the primary path on MDK 0.8.

**Admin handoff:** Pacto does **not** currently expose “add admin” / “transfer MLS admin”. Only the creator is admin at creation. If the **creator leaves**, the MLS group may end up with **no admins** → **no further kicks** from MLS until MDK + app support admin updates. Squad-level roles (e.g. Hats) are a separate product layer.

---

## 4. “Pending proposal” errors

**Symptoms:** Logs like **`Can't create message because a pending proposal exists`**, **`Unprocessable event`**.

**Cause:** MLS **proposals** must be applied in a **commit**. Until then, the engine may block **new application messages** for that group.

**Common cases:**

1. **You left:** Local metadata is gone but the **engine** may still hold the group with a pending leave proposal.  
2. **Someone else’s proposal** not yet committed / auto-commit not published+merged.  
3. **`merge_pending_commit`** did not run after an add/remove / auto-commit path.

**Mitigation:** Remaining members run **`publish_and_merge_auto_commit`** on **`Proposal(UpdateGroupResult)`**; fallback admin finalize for legacy Unprocessable leaves. Restart/re-sync if wedged.

---

## 5. Commands / events (reference)

| Action | API |
|--------|-----|
| Kick | Tauri command → **`remove_member_device(group_id, member_pubkey, device_id)`** |
| Leave | **`leave_mls_group(group_id)`** |
| Auto-commit leave (internal) | **`publish_and_merge_auto_commit`** after **`Proposal(UpdateGroupResult)`** |
| UI refresh | **`mls_group_left`**, **`mls_group_updated`**, **`list_mls_groups`** (excludes evicted) |
| Leave notice | Structured MLS JSON **`type: squad_member_left`** on announcements hub |

---

*Condensed from internal MLS eviction / leave notes.*

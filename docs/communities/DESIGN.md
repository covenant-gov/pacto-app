# Communities — squads & in-app networks

Squads and **Networks** share the same **MLS + channels** stack. Code uses `Squad` / `Network`, keys like `pacto_networks_<npub>` — this doc is the contributor map for that product area.

| Concept | What it is |
|---------|------------|
| **Squad** | MLS channel group; stable id = **announcements MLS group id**. |
| **Network** | Several squads under one umbrella (`memberSquads`); same id rule as squads. |

**Related:** [`docs/mls/`](../mls/), [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md). Code: grep `Squad`, `Network`, `pacto_squads`, `pacto_networks` in `src/stores/`.

---

## 1. How they relate

Both **squads** and **in-app networks** use **MLS channels** for chat. Members see **channels**; each channel is backed by an **MLS `groupId`**. The **first channel** is always the **announcements** channel.

**Squad** — one cohesive group: participants, announcements channel, optional extra channels. The app needs a **single stable string** so every device refers to the **same** squad when the backend emits events (e.g. a new channel was added).

**Network** (the **Networks** tab / `Network` type) — bundles **multiple squads** (`memberSquads`) under one named network, with the **same channel / MLS mechanics** as a squad. Invites and “add channel” events must use the **same kind of stable parent id** squads use, or invitees will not see new channels.

So anything that works for **squad identity** (stable id = announcements MLS group) is the **baseline**; networks **must follow that pattern** for `network.id`, not invent a second id scheme (see below).

---

## 2. Stable identity: announcements MLS group id

For a **squad**, the id everyone shares is the **MLS group id of the announcements channel** (hex string from the backend when that group is created). Events like **`channel_added_to_squad`** carry that id; the frontend finds the squad with **`squad.id === announcements_group_id`**. All members match the same object.

**Networks must use the same rule:** **`network.id` = MLS group id of that network’s announcements channel.**

If **`network.id`** were a **random UUID generated on each device**, the **creator** and **invitees** would store **different** ids for “the same” network. The backend would emit **`channel_added_to_network`** with the creator’s id; invitees would look up **`network.id`** and find **nothing**, so **new channels never appear** for them. That bug is fixed by **never** using `crypto.randomUUID()` for the canonical **`network.id`** — always set it from the **announcements `groupId`** returned when that MLS group is created or from the **invite payload**.

| Moment | What to set |
|--------|-------------|
| **Create network** | After creating the announcements MLS group (same pattern as squad), set **`network.id = groupId`**. |
| **Accept network invite** | Set **`network.id = payload.groupId`** (the announcements group id in the invite). |
| **Backend → UI** | Parent for “channel added” should be **`announcements_group_id`** (or the same value as `network.id`). Frontend: **`networks.find(n => n.id === announcements_group_id)`**. |

Structured DMs that carry a **`networkId`** should use that **same** announcements MLS group id end-to-end.

---

## 3. Naming

The announcements channel label should be **`"announcements"`** (lowercase) for **everyone** — avoid **`"Announcements"`** on only the creator or only the invite path.

---

## 4. Network data model (extra fields vs squad)

Squads already have **`id`**, **`name`**, **`channels`**, etc. **Networks** add the list of squads that formed the network (for subtitles and invite cards):

```ts
export interface Network {
  id: string; // announcements MLS group id — same stability rule as squad.id
  name: string;
  iconUrl?: string;
  channels: Channel[];
  /** Squads included when the network was created; names snapshot at creation */
  memberSquads: { id: string; name: string }[];
  createdAt: number;
  updatedAt: number;
}
```

- **`channels[0]`** (by `order`) is the announcements MLS group.
- **`memberSquads`**: product rule is typically **at least two** squads at creation.

Exact `Squad` / `Channel` types live in `src/stores/` — align names with the codebase.

---

## 5. Persistence (local)

Same **per-npub** discipline as squads:

| Key / state | Purpose |
|-------------|---------|
| **`pacto_networks_<npub>`** | Serialized `Network[]` |
| **`activeNetworkId`**, **`lastOpenedNetworkId`**, **`lastOpenedNetworkChannelId`** | UI selection + restore |
| **`pacto_last_network_id_<npub>`**, **`pacto_last_network_channel_id_<npub>`** | Optional “last opened” |

On **logout** or **account switch**, clear these via **`clearAccountState`** / **`SCOPED_KEY_PREFIXES`** so another npub never loads the previous account’s networks (mirror the **squads** pattern).

---

## 6. Network invite DM

Payload shape (conceptual; implement next to other DM JSON helpers):

```ts
interface NetworkInvitePayload {
  type: 'network_invite';
  networkName: string;
  groupId: string; // announcements channel → becomes network.id
  memberSquads: { id: string; name: string }[];
}
```

---

## 7. Message loading: treat like squads

If **network** channel messages are **empty after restart** while **squad** channels load fine, the usual cause is resolving the open channel by **wrong id** (e.g. stale UUID) instead of the channel’s **`groupId`**. **Entering a network channel** should run the **same** path as **entering a squad channel** (fetch/hydrate by MLS **`groupId`**).

---

## 8. Checklist (networks + channels)

- [ ] **`network.id`** comes from the **announcements MLS `groupId`**, not `randomUUID()`.  
- [ ] Invite accept sets **`network.id`** from **`groupId`** in the payload.  
- [ ] **`channel_added_to_network`** resolves the parent with **`announcements_group_id`** (same value as `network.id`).  
- [ ] **`networkId` in DMs** is that same announcements group id.  
- [ ] First channel name **`"announcements"`** (lowercase) on all paths.  
- [ ] **localStorage** keys are **scoped by npub**; cleared on logout.  
- [ ] Open-channel / message load for networks matches squads (`groupId`).

---

*Contributor notes: squads first, in-app networks follow the same MLS identity rules.*

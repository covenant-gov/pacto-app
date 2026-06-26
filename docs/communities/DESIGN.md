# Communities — squads & squad-pairs

Squads and **squad-pairs** (partner coordination between two anchor squads) share the same **MLS + channels** stack. All parent rows live in `pacto_squads_<npub>` with optional `kind: 'squad-pair'` and `pairedSquads`.

| Concept | What it is |
|---------|------------|
| **Squad** | MLS channel group; stable id = **announcements MLS group id**. |
| **Squad-pair** | Partner coordination parent linking two anchor squads (`pairedSquads`); same id rule as squads. |

**Related:** [`docs/mls/`](../mls/), [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md). Code: `Squad`, `kind`, `pairedSquads` in `src/stores/squads.ts` (re-exported from `stores/app.ts` barrel) and `src/lib/squad-pair.ts`.

---

## 1. How they relate

Both **squads** and **squad-pairs** use **MLS channels** for chat. Members see **channels**; each channel is backed by an **MLS `groupId`**. The **first channel** is always the **announcements** channel.

**Squad** — one cohesive group: participants, announcements channel, optional extra channels.

**Squad-pair** — coordination between **two anchor squads** (`pairedSquads`). Listed under **Partner Squads** in the anchor squad sidebar. Created via **Pair with squad…** from an anchor squad (RNF-3).

The app needs a **single stable string** per parent so every device refers to the **same** squad or squad-pair when the backend emits events (e.g. a new channel was added).

---

## 2. Stable identity: announcements MLS group id

For any parent (squad or squad-pair), the id everyone shares is the **MLS group id of the announcements channel** (hex string from the backend when that group is created). Events like **`channel_added_to_squad`** carry that id; the frontend finds the parent with **`squad.id === announcements_group_id`**.

| Moment | What to set |
|--------|-------------|
| **Create parent** | After creating the announcements MLS group, set **`squad.id = groupId`**. |
| **Accept invite** | Set **`squad.id = payload.groupId`** (announcements group id in the invite). |
| **Backend → UI** | Parent for “channel added” uses **`announcements_group_id`**. Frontend: **`squads.find(s => s.id === announcements_group_id)`**. |

Structured DMs that carry a parent id should use that **same** announcements MLS group id end-to-end.

---

## 3. Naming

The announcements channel label should be **`"announcements"`** (lowercase) for **everyone**.

Default hub channels after invite accept: **dashboard**, **announcements**, **inbox**, **polls** (see `defaultChannelRowsForGroupId` in `src/lib/parent-navbar.ts`).

---

## 4. Squad-pair metadata

```ts
export type SquadKind = 'squad' | 'squad-pair';

export interface Squad {
  id: string; // announcements MLS group id
  name: string;
  kind: SquadKind;
  pairedSquads?: [{ id: string; name: string }, { id: string; name: string }];
  channels: Channel[];
  // ...
}
```

- **`channels[0]`** (by `order`) is the announcements MLS group.
- **`pairedSquads`**: exactly two anchor squads when `kind === 'squad-pair'`.

---

## 5. Persistence (local)

| Key / state | Purpose |
|-------------|---------|
| **`pacto_squads_<npub>`** | Serialized `Squad[]` (includes squad-pairs) |
| **`pacto_last_squad_id_<npub>`** | Last opened squad / squad-pair |
| **`pacto_last_channel_by_squad_<npub>`** | Per-parent last channel |

---

## 6. Invites

- **Squad / squad-pair invites:** `squad_invite` payload with optional `kind: 'squad-pair'` and `pairedSquads`. Routed to **Pacto App** pinned inbox (RNF-4).
- **Channel invites:** `channel_in_squad` with `announcementsGroupId` = parent id.

---

## 7. Commons discovery

Public squads and users may publish time-bounded broadcasts to **Commons** (top-nav discovery feed). See [`COMMONS.md`](./COMMONS.md).

---

## 8. Contributor checklist

- [ ] New parent ids come from announcements **`groupId`**, never per-device UUIDs.
- [ ] Squad-pairs use `kind: 'squad-pair'` + `pairedSquads`; no separate network store.
- [ ] **`channel_added_to_squad`** resolves the parent with **`announcements_group_id`**.

# Communities — squads & squad-pairs

Squads and **squad-pairs** (partner coordination between two anchor squads) share the same **MLS + channels** stack. The squad catalog is stored in SQLite (`squads` table); the frontend `squads` store hydrates from it on login. See [`SQUAD_CATALOG.md`](./SQUAD_CATALOG.md).

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

Default hub channels after invite accept: **dashboard**, **announcements**, **join-requests**, **personal-alerts**, **polls** (see `defaultChannelRowsForGroupId` / `buildHubSidebarChannels` in `src/lib/parent-navbar.ts`). When the default channels share one MLS group id, the sidebar rows partition one physical stream by virtual bucket — see [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md).

### Hub channel semantics (product)

| Sidebar row | Virtual bucket | Purpose |
|-------------|----------------|---------|
| **#announcements** | `announcements` | Chat plus **squad-wide state** everyone should see: member roster EVM address shares/updates (`squad_member_evm_share`), sponsor deploy announces, dashboard poll created, squad bot metadata / key-rotated notices. |
| **#join-requests** | `join_requests` | Private Commons join request fan-out and accept/reject (MLS virtual bucket; bot DM ingress — [`SQUAD_BOT_JOIN.md`](./SQUAD_BOT_JOIN.md)). Not a separate MLS group. |
| **#personal-alerts** | `inbox` | **Prompts to action** for the viewing member only — e.g. the roster signer setup card (`SquadRosterKeyInboxCard`) until they bind a squad-purpose EVM account; bot key rotate prompts for holders. Not a feed of other members' automation. |
| **#polls** | `polls` | Dashboard poll vote wire traffic. |

**Roster EVM:** Each member must explicitly bind a squad-purpose signer (`squad_member_evm_account`) via **#personal-alerts**. After binding, the client publishes `squad_member_evm_share` to **#announcements** so the squad sees the address change. Profile backfill into `squad_member_evm` does **not** satisfy the prompt — only an explicit account binding does.

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

## 5. Persistence

| Location | Purpose |
|----------|---------|
| **`squads` (SQLite)** | Squad catalog: name, channels, kind, visibility, commons tags, squad-pair metadata — [`SQUAD_CATALOG.md`](./SQUAD_CATALOG.md) |
| **`pacto_last_squad_id_<npub>`** | Last opened squad / squad-pair (`localStorage`) |
| **`pacto_last_channel_by_squad_<npub>`** | Per-parent last channel (`localStorage`) |

Roster bindings (`squad_member_evm_account`, `squad_member_evm`) and on-chain infra (`squad_infra`, `parent_treasury_safe`) are also SQLite; keyed by the same `parent_id`.

---

## 6. Invites

- **Squad / squad-pair invites:** `squad_invite` payload with optional `kind: 'squad-pair'` and `pairedSquads`. Routed to **Pacto App** pinned inbox (RNF-4).
- **Channel invites:** `channel_in_squad` with `announcementsGroupId` = parent id.

---

## 7. Commons discovery

Squads with **Commons on** and users may publish time-bounded broadcasts to **Commons** (top-nav discovery feed). The MLS squad stays private; only the Nostr mirror is public. See [`COMMONS.md`](./COMMONS.md).

---

## 8. Contributor checklist

- [ ] New parent ids come from announcements **`groupId`**, never per-device UUIDs.
- [ ] Squad-pairs use `kind: 'squad-pair'` + `pairedSquads`; no separate network store.
- [ ] **`channel_added_to_squad`** resolves the parent with **`announcements_group_id`**.

# Shell layout

How the logged-in app shell is split after the SM refactor: **Svelte orchestrates**, **`src/lib/` owns side effects and testable decisions**.

---

## Top-level map

```
src/routes/+page.svelte           layout, tab routing, DM send/typing; mounts app event bridge
src/components/layout/ParentNavbar.svelte   sidebar + modals → lib/parent/* flows
src/components/parent/ParentDashboard.svelte   #squad-dashboard tab shell (Status→Governance→Treasury→Roles→Crew)
src/components/parent/MyDashboard.svelte       #my-dashboard tab shell (Status→Alerts)
src/components/dm/DmThread.svelte             header/input/options + DmMessageRouter
src/stores/app.ts                 thin re-export barrel (navigation, dm, squads, mls-chat, persistence)
```

**Invariant:** Components bind UI and call libs; avoid new cross-cutting logic in `+page.svelte` or monolithic stores.

---

## Hub sidebar (pinned vs custom)

Pinned system channels stay **above** a thin gray divider; member-created MLS channels stay **below**.

**Pinned order:** `squad-dashboard` → `my-dashboard` → `announcements` → `polls`

`personal-alerts` and `join-requests` are **not** sidebar channels. MLS buckets `inbox` and `join_requests` still exist for transport; UI surfaces them under **My Dashboard → Alerts** and **Squad Dashboard → Crew**.

---

## Stores (`src/stores/`)

| Module | Owns |
|--------|------|
| `navigation.ts` | Top nav, squad/channel selection, squad/my dashboard modes, last-opened maps |
| `dm.ts` | DMs, inbox, sync, typing, wallet sidebar, `DmMessage` |
| `squads.ts` | `Squad`, channels, treasury/infra maps, parent create state |
| `mls-chat.ts` | Group messages, welcomes, membership version |
| `persistence.ts` | `loadAccountState` orchestration |
| `persistence-context.ts` | `currentNpubForPersistence`, `persistenceKey` (breaks import cycles) |
| `app.ts` | Re-export barrel only |

Prefer **direct imports** from domain slices in new code; the barrel remains for gradual migration.

---

## Lib modules (`src/lib/`)

| Path | Role |
|------|------|
| `app/tauri-subscriptions.ts` | `subscribeAppEvents(handlers)` — single teardown for backend → UI events |
| `invites/accept-invite.ts` | Squad/pair/channel invite accept; single-flight; `resetInviteAcceptState()` |
| `parent/create-channel-flow.ts` | MLS channel create + channel-in-squad DMs |
| `parent/invite-members-flow.ts` | Invite candidates + MLS/squad invite DMs |
| `parent/exit-parent-flow.ts` | Local remove + MLS leave with revert on failure |
| `squad-pair-create.ts` | Pair create + `retryParentAnnouncementsCreate` |
| `dm/resolve-dm-message-presentation.ts` | DM content → presentation kind (pure) |
| `dashboard/parent-dashboard-loaders.ts` | Shared squad-dashboard fetch helpers |

---

## Component routers / tabs

| Path | Role |
|------|------|
| `components/dm/DmMessageRouter.svelte` | Invite cards, wallet cards, plain `Message` |
| `components/parent/dashboard/DashboardStatusTab.svelte` | Broadcast, bot, network, permissions overview |
| `components/parent/dashboard/DashboardGovernanceTab.svelte` | Pacto Gov role sub-modes (Proposals / Crew / Captain) |
| `components/parent/dashboard/DashboardRolesTreeTab.svelte` | Hats tree |
| `components/parent/dashboard/DashboardTreasuryTab.svelte` | Sponsor + governance treasury Safe + other vaults |
| `components/parent/dashboard/DashboardCrewTab.svelte` | MLS member roster (EVM / Hats / Privileges) + join requests |
| `components/parent/dashboard/MyDashboardStatusTab.svelte` | Member checklist + roster EVM |
| `components/parent/dashboard/MyDashboardAlertsTab.svelte` | Roster-key prompts (former personal-alerts) |
| `components/parent/dashboard/ParentDashboardModals.svelte` | Deploy/import Safe + privilege modals |
| `components/parent/dashboard/ParentDashboardMembersPanel.svelte` | Members aside |

Squad dashboard modes: `squadDashboardChannelMode` (`status` \| `governance` \| `treasury` \| `roles` \| `crew`).
My dashboard modes: `myDashboardChannelMode` (`status` \| `alerts`).

**Keep-alive:** After a Squad Dashboard mode is visited once, `ParentDashboard` keeps that tab mounted and toggles visibility with `hidden`/CSS so form and sub-mode state survive mode switches (avoids remount races on Mutiny / QM / Safe loaders).

Governance uses role sub-modes inside `PactoGovGovernanceShell` (Proposals read board + Crew/Captain action panes). CTAs use **ACL** (access control) snapshots from `get_squad_capabilities` (`src/lib/governance/governance-privilege.ts`). Normative rules: [`docs/governance/ACCESS_CONTROL.md`](../governance/ACCESS_CONTROL.md).

---

## Related docs

- [`docs/communities/DESIGN.md`](../communities/DESIGN.md) — squads, squad-pairs, stable ids
- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — DM vs MLS transport
- [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md) — UI surface ≠ MLS bucket
- [`docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md) — wallet DM payloads routed by `DmMessageRouter`
- [`docs/wallet/ONCHAIN_READ_PATTERN.md`](../wallet/ONCHAIN_READ_PATTERN.md) — persist / hydrate / SWR (wallet; dashboard uses the same pattern)

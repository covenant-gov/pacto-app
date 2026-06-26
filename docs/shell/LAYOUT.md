# Shell layout

How the logged-in app shell is split after the SM refactor: **Svelte orchestrates**, **`src/lib/` owns side effects and testable decisions**.

**Execution history:** [`ai-docs/shell-refactor/SHELL_MODULARIZATION_PLAN.md`](../../ai-docs/shell-refactor/SHELL_MODULARIZATION_PLAN.md)

---

## Top-level map

```
src/routes/+page.svelte           layout, tab routing, DM send/typing; mounts app event bridge
src/components/layout/ParentNavbar.svelte   sidebar + modals → lib/parent/* flows
src/components/parent/ParentDashboard.svelte   #dashboard tab shell + loader triggers + deploy bar
src/components/dm/DmThread.svelte             header/input/options + DmMessageRouter
src/stores/app.ts                 thin re-export barrel (navigation, dm, squads, mls-chat, persistence)
```

**Invariant:** Components bind UI and call libs; avoid new cross-cutting logic in `+page.svelte` or monolithic stores.

---

## Stores (`src/stores/`)

| Module | Owns |
|--------|------|
| `navigation.ts` | Top nav, squad/channel selection, dashboard mode, last-opened maps |
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
| `dashboard/parent-dashboard-loaders.ts` | Shared `#dashboard` fetch helpers |

---

## Component routers / tabs

| Path | Role |
|------|------|
| `components/dm/DmMessageRouter.svelte` | Invite cards, wallet cards, plain `Message` |
| `components/parent/dashboard/DashboardGovernanceTab.svelte` | Treasury proposals |
| `components/parent/dashboard/DashboardRolesTreeTab.svelte` | Hats tree |
| `components/parent/dashboard/DashboardTreasuryTab.svelte` | Vaults + sponsor panel |
| `components/parent/dashboard/DashboardSettingsTab.svelte` | Permissions + roster |
| `components/parent/dashboard/ParentDashboardModals.svelte` | Deploy/import Safe + role modals |
| `components/parent/dashboard/ParentDashboardMembersPanel.svelte` | `#dashboard` members aside |

Dashboard tab persistence: `parentDashboardChannelMode` in `stores/navigation.ts` (`governance` | `roles_tree` | `treasury` | `settings`).

---

## Related docs

- [`docs/communities/DESIGN.md`](../communities/DESIGN.md) — squads, squad-pairs, stable ids
- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — DM vs MLS transport
- [`docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md) — wallet DM payloads routed by `DmMessageRouter`
- [`docs/wallet/ONCHAIN_READ_PATTERN.md`](../wallet/ONCHAIN_READ_PATTERN.md) — persist / hydrate / SWR (wallet; dashboard extension in SP plan)
- [`ai-docs/speed/UX_SPEED_AND_DATA_READ_PLAN.md`](../../ai-docs/speed/UX_SPEED_AND_DATA_READ_PLAN.md) — executable UX speed backlog (SP-1–4)

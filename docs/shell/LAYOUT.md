# Shell layout

How the logged-in app shell is split after the SM refactor: **Svelte orchestrates**, **`src/lib/` owns side effects and testable decisions**.

---

## Top-level map

```
src/routes/+page.svelte           layout, tab routing, DM send/typing; mounts app event bridge
src/components/layout/ParentNavbar.svelte   sidebar + modals → lib/parent/* flows
src/components/parent/ParentDashboard.svelte   #squad-dashboard tab shell (Status→Governance→Treasury→Crew)
src/components/parent/MyDashboard.svelte       #my-dashboard tab shell (Status→Alerts)
src/components/parent/SquadSettingsView.svelte #settings virtual channel (squad settings stack)
src/components/dm/DmThread.svelte             header/input/options + DmMessageRouter
src/stores/app.ts                 thin re-export barrel (navigation, dm, squads, mls-chat, persistence)
```

**Invariant:** Components bind UI and call libs; avoid new cross-cutting logic in `+page.svelte` or monolithic stores.

---

## Hub sidebar (pinned vs custom)

Pinned system channels stay **above** a thin gray divider; member-created MLS channels stay **below**.

**Pinned order:** `squad-dashboard` → `squad-wargame` (when Active) → `my-dashboard` → `announcements` → `polls` → `settings`

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
| `components/parent/dashboard/DashboardStatusTab.svelte` | Checklist + live Proposals board |
| `components/parent/dashboard/DashboardSettingsTab.svelte` | Squad photo, Broadcast, Stickers, Primary/Practice networks, Chain RPC / Pimlico, Join-inbox holders — mounted from `#settings` |
| `components/parent/dashboard/DashboardGovernanceTab.svelte` | All / Crew / Captain commands + Hats tree |
| `components/parent/dashboard/DashboardRolesTreeTab.svelte` | Hats tree (mounted at the bottom of Governance) |
| `components/parent/dashboard/DashboardTreasuryTab.svelte` | Sponsor + governance treasury Safe + other vaults |
| `components/parent/dashboard/DashboardCrewTab.svelte` | MLS member roster (EVM / Hats / Privileges) + join requests |
| `components/parent/dashboard/MyDashboardStatusTab.svelte` | Member checklist + roster EVM |
| `components/parent/dashboard/MyDashboardAlertsTab.svelte` | Roster-key prompts (former personal-alerts) |
| `components/parent/dashboard/ParentDashboardModals.svelte` | Deploy/import Safe + privilege modals |
| `components/parent/dashboard/ParentDashboardMembersPanel.svelte` | Members aside |

Squad dashboard modes: `squadDashboardChannelMode` (`status` \| `governance` \| `treasury` \| `crew`). Squad settings live on the pinned `#settings` channel.
My dashboard modes: `myDashboardChannelMode` (`status` \| `alerts`).

**Status vs Settings.** Status is for frequently needed operational info: Checklist, live Proposals. Settings is for one-time or occasional config: squad photo, Squad Broadcast, sticker packs, network, Chain RPC, Pimlico key, Join-inbox holders. Network retargeting for future deploys lives in Settings ([`docs/wallet/CHAIN_CONFIG.md`](../wallet/CHAIN_CONFIG.md)). Unknown persisted dashboard modes (including the former `stickers` and `roles` slugs) reset to `status`. Arbitrary contract allowlist / call UI is not on Settings.

**Invariant:** do not add a new `#squad-dashboard` segmented mode for a single feature. Occasional config goes in a Settings **section**. A new tab is only for a frequently used operational domain with its own data (Governance, Treasury, Crew). Hats tree lives under Governance, not its own tab. Stickers as its own tab is the anti-pattern.

**Keep-alive:** After a Squad Dashboard mode is visited once, `ParentDashboard` keeps that tab mounted and toggles visibility with `hidden`/CSS so form and sub-mode state survive mode switches (avoids remount races on Mutiny / QM / Safe loaders).

Governance uses role sub-modes inside `PactoGovGovernanceShell` (All / Crew / Captain command panes; Status owns the live Proposals board). Propose and vote-mode writes live on **All**; process votes live on Status cards. CTAs use **ACL** (access control) snapshots from `get_squad_capabilities` (`src/lib/governance/governance-privilege.ts`). Normative rules: [`docs/governance/ACCESS_CONTROL.md`](../governance/ACCESS_CONTROL.md).

---

## Related docs

- [`docs/communities/DESIGN.md`](../communities/DESIGN.md) — squads, squad-pairs, stable ids
- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — DM vs MLS transport
- [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md) — UI surface ≠ MLS bucket
- [`docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md) — wallet DM payloads routed by `DmMessageRouter`
- [`docs/wallet/ONCHAIN_READ_PATTERN.md`](../wallet/ONCHAIN_READ_PATTERN.md) — persist / hydrate / SWR (wallet; dashboard uses the same pattern)

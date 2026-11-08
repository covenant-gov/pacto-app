# Shell layout

How the logged-in app shell is split after the SM refactor: **Svelte orchestrates**, **`src/lib/` owns side effects and testable decisions**.

---

## Top-level map

```
src/routes/+page.svelte                    thin lazy loader → AuthenticatedApp
src/components/app/AuthenticatedApp.svelte layout, tab routing, DM send/typing; mounts app event bridge
src/components/layout/ParentNavbar.svelte   sidebar + modals → lib/parent/* flows
src/components/parent/ParentDashboard.svelte   #squad-dashboard tab shell (Status→Governance→Treasury→Crew)
src/components/parent/SquadSettingsView.svelte #settings virtual channel (You | Us | Access | Network)
src/components/dm/DmThread.svelte             header/input/options + DmMessageRouter
src/stores/app.ts                 thin re-export barrel (navigation, dm, squads, mls-chat, persistence)
```

**Invariant:** Components bind UI and call libs; avoid new cross-cutting logic in `AuthenticatedApp.svelte` or monolithic stores. Unauth cold-start rules: [`docs/auth/FIRST_PAINT.md`](../auth/FIRST_PAINT.md).

---

## Hub sidebar (pinned vs custom)

Pinned system channels stay **above** a thin gray divider; member-created MLS channels stay **below**.

**Pinned order:** `squad-dashboard` → `squad-wargame` (when Active) → `announcements` → `polls` → `settings`

`personal-alerts` and `join-requests` are **not** sidebar channels. MLS buckets `inbox` and `join_requests` still exist for transport; UI surfaces them under **`#settings` → You → Alerts** and **`#settings` → Access → Join requests**. Persisted `__my_dashboard__` remaps to `#settings`.

---

## Stores (`src/stores/`)

| Module | Owns |
|--------|------|
| `navigation.ts` | Top nav, squad/channel selection, squad dashboard and settings channel modes, last-opened maps |
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
| `components/parent/dashboard/DashboardStatusTab.svelte` | Checklist + Proposals board (Open \| Executed \| Failed); Squad Admin card when the squad has a standalone `squad_admin` row and no Pacto Gov |
| `components/parent/dashboard/SquadAdminStatusCard.svelte` | Admin-only deployed state: variant copy, proxy (copy), network, CTA to Settings → Access → Privileges |
| `components/parent/dashboard/DashboardSettingsUsTab.svelte` | Squad photo, Commons broadcast, stickers — `#settings` Us |
| `components/parent/dashboard/DashboardSettingsAccessTab.svelte` | Join requests, Privileges (ACL / Squad Admin), content policy, Join-inbox holders — `#settings` Access |
| `components/parent/dashboard/DashboardSettingsNetworkTab.svelte` | Primary/Practice networks, Chain RPC / Pimlico — `#settings` Network |
| `components/parent/dashboard/DashboardGovernanceTab.svelte` | All / Crew / Captain commands + Hats tree |
| `components/parent/dashboard/DashboardRolesTreeTab.svelte` | Hats tree (mounted at the bottom of Governance) |
| `components/parent/dashboard/DashboardTreasuryTab.svelte` | Sponsor + governance treasury Safe + other vaults |
| `components/parent/dashboard/DashboardCrewTab.svelte` | MLS member roster (EVM / Hats / role labels) |
| `components/parent/dashboard/MyDashboardStatusTab.svelte` | Member checklist + roster EVM |
| `components/parent/dashboard/MyDashboardAlertsTab.svelte` | Roster-key prompts (former personal-alerts) |
| `components/parent/dashboard/ParentDashboardModals.svelte` | Deploy/import Safe + privilege modals |
| `components/parent/dashboard/ParentDashboardMembersPanel.svelte` | Members aside |

Squad dashboard modes: `squadDashboardChannelMode` (`status` \| `governance` \| `treasury` \| `crew`). `#settings` uses `settingsChannelMode` (`you` \| `us` \| `access` \| `network`): You is checklist, Alerts, roster EVM, then squad sync; Us is photo / broadcast / stickers; Access is join requests, privileges, content policy, join-inbox holders; Network is primary/practice chains, RPC, Pimlico. Leftover `personal` remaps to `you`. Unknown persisted settings modes (including `squad`) reset to `you`.

**Status vs Settings.** Status is for frequently needed operational info: Checklist, live Proposals. Settings is for one-time or occasional config, split across You / Us / Access / Network. Network retargeting for future deploys lives in Settings → Network ([`docs/wallet/CHAIN_CONFIG.md`](../wallet/CHAIN_CONFIG.md)). Unknown persisted dashboard modes (including the former `stickers` and `roles` slugs) reset to `status`. Arbitrary contract allowlist / call UI is not on Settings.

**Invariant:** do not add a new `#squad-dashboard` segmented mode for a single feature. Occasional config goes in a Settings **section**. A new tab is only for a frequently used operational domain with its own data (Governance, Treasury, Crew). Hats tree lives under Governance, not its own tab. Stickers as its own tab is the anti-pattern.

**Keep-alive:** After a Squad Dashboard mode is visited once, `ParentDashboard` keeps that tab mounted and toggles visibility with `hidden`/CSS so form and sub-mode state survive mode switches (avoids remount races on Mutiny / QM / Safe loaders). `#settings` uses the same keep-alive for You, Us, Access, and Network panes.

Governance uses role sub-modes inside `PactoGovGovernanceShell` (All / Crew / Captain command panes; Status owns the Proposals board). The board filters **Open | Executed | Failed** for treasury proposals and mutiny rounds. Crew offboard and crew add/remove stay on Open only, and leave the board when they finish. Propose and vote-mode writes live on **All**; process votes live on Status cards. CTAs use **ACL** (access control) snapshots from `get_squad_capabilities` (`src/lib/governance/governance-privilege.ts`). Normative rules: [`docs/governance/ACCESS_CONTROL.md`](../governance/ACCESS_CONTROL.md).

---

## Related docs

- [`docs/communities/DESIGN.md`](../communities/DESIGN.md) — squads, squad-pairs, stable ids
- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — DM vs MLS transport
- [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md) — UI surface ≠ MLS bucket
- [`docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md) — wallet DM payloads routed by `DmMessageRouter`
- [`docs/wallet/ONCHAIN_READ_PATTERN.md`](../wallet/ONCHAIN_READ_PATTERN.md) — persist / hydrate / SWR (wallet; dashboard uses the same pattern)

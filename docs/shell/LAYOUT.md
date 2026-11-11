# Shell layout

How the logged-in app shell is split after the SM refactor: **Svelte orchestrates**, **`src/lib/` owns side effects and testable decisions**.

---

## Top-level map

```
src/routes/+page.svelte                    thin lazy loader → AuthenticatedApp
src/components/app/AuthenticatedApp.svelte layout, tab routing, DM send/typing; mounts app event bridge
src/components/layout/ParentNavbar.svelte   sidebar + modals → lib/parent/* flows
src/components/parent/SquadGovernanceView.svelte   #governance tab shell (Live|Wargame × Status→Governance→Treasury→Crew)
src/components/parent/SquadSettingsView.svelte #settings virtual channel (You | About | Network)
src/components/parent/SquadToolsView.svelte    #tools shelf (Polls | Events | Docs | Stickers); mounted from SquadHubMain, not ChatView
src/components/parent/HubViewShell.svelte      shared hub chrome: header + mode switcher + members rail
src/components/parent/HubChannelHeader.svelte  shared `#name` hub header
src/components/parent/HubModeSwitcher.svelte   shared segmented mode switcher
src/components/dm/DmThread.svelte             header/input/options + DmMessageRouter
src/stores/app.ts                 thin re-export barrel (navigation, dm, squads, mls-chat, persistence)
```

**Invariant:** Components bind UI and call libs; avoid new cross-cutting logic in `AuthenticatedApp.svelte` or monolithic stores. Unauth cold-start rules: [`docs/auth/FIRST_PAINT.md`](../auth/FIRST_PAINT.md).

---

## Hub sidebar (pinned vs custom)

Pinned system channels stay **above** a thin gray divider; member-created MLS channels stay **below**.

**Pinned order:** `announcements` → `governance` → `tools` → `settings`

Wargame is **not** a sidebar row. It is the **Live | Wargame** context switch in the `#governance` header. Internal channel ids `__governance__` / `__gov_practice__` still select the stack for keep-alive and `lastChannelBySquadId`; the sidebar `#governance` row highlights for either id and restores the last stack on click. With no remembered stack and no live `pacto_gov`, open Wargame (practice first).

`personal-alerts` and `join-requests` are **not** sidebar channels. MLS buckets `inbox` and `join_requests` still exist for transport; UI surfaces them under **`#settings` → You → Alerts** and **`#settings` → About → Pending** (outbound invites + Commons join requests). Persisted `__my_dashboard__` remaps to `#settings`.

---

## Stores (`src/stores/`)

| Module | Owns |
|--------|------|
| `navigation.ts` | Top nav, squad/channel selection, governance / settings / tools channel modes, last-opened maps |
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
| `dashboard/parent-dashboard-loaders.ts` | Shared governance-hub fetch helpers |

---

## Component routers / tabs

| Path | Role |
|------|------|
| `components/dm/DmMessageRouter.svelte` | Invite cards, wallet cards, plain `Message` |
| `components/parent/dashboard/DashboardStatusTab.svelte` | Checklist + Proposals board (Open \| Executed \| Failed); Squad Admin card when the squad has a standalone `squad_admin` row and no Pacto Gov |
| `components/parent/dashboard/SquadAdminStatusCard.svelte` | Admin-only deployed state: variant copy, proxy (copy), network, CTA to Governance → Crew → Privileges |
| `components/parent/dashboard/DashboardSettingsAboutTab.svelte` | Squad photo, Commons broadcast, Invite + Pending, Join-inbox holders — `#settings` About |
| `components/parent/dashboard/CrewPrivilegesSection.svelte` | Catalog-driven Privileges under `#governance` Crew: create role (name + flags) or assign/revoke on a selected role — exclusive panes, two txs |
| `components/parent/SquadToolsView.svelte` | `#tools` mode panes: polls, events, docs, stickers |
| `components/parent/dashboard/DashboardSettingsNetworkTab.svelte` | Primary/Practice networks, Chain RPC / Pimlico — `#settings` Network |
| `components/parent/dashboard/DashboardGovernanceTab.svelte` | All / Crew / Captain commands + Hats tree |
| `components/parent/dashboard/DashboardRolesTreeTab.svelte` | Hats tree (mounted at the bottom of Governance) |
| `components/parent/dashboard/DashboardTreasuryTab.svelte` | Sponsor + governance treasury Safe + other vaults |
| `components/parent/dashboard/DashboardCrewTab.svelte` | MLS member roster (EVM / Hats / privileges) + CrewPrivilegesSection |
| `components/parent/dashboard/MyDashboardStatusTab.svelte` | Member checklist + roster EVM |
| `components/parent/dashboard/MyDashboardAlertsTab.svelte` | Roster-key prompts (former personal-alerts) |
| `components/parent/dashboard/ParentDashboardModals.svelte` | Deploy/import Safe + privilege modals |
| `components/parent/dashboard/ParentDashboardMembersPanel.svelte` | Members aside |

`#governance` stack: Live (`__governance__`) vs Wargame (`__gov_practice__`) via header switcher — not a fifth domain segment. Domain modes: `squadGovernanceChannelMode` (`status` \| `governance` \| `treasury` \| `crew`), shared across stacks. Persistence key `pacto_squad_governance_mode_<npub>`; superseded `pacto_squad_dashboard_mode_*` is ignored (mode resets to `status`). Chrome symbols: `SQUAD_GOVERNANCE_CHANNEL_*`, `isSquadGovernanceChromeChannelId`, `openSquadGovernance` / `open-squad-governance.ts` (NavigationTarget `squad-governance`). Crew hosts the member roster and **Privileges** (packed SquadAdmin `bytes32` roles): register a catalog role, then assign an executor — separate panes and txs. `#settings` uses `settingsChannelMode` (`you` \| `about` \| `network`): You is checklist, Alerts, roster EVM, then squad sync; About is photo / broadcast / invite+pending / join-inbox holders; Network is primary/practice chains, RPC, Pimlico. Leftover `personal` remaps to `you`; leftover `us` remaps to `about`. Unknown persisted settings modes (including `squad` and `access`) reset to `you`. `#tools` uses `squadToolsChannelMode` (`polls` \| `events` \| `docs` \| `stickers`); legacy sidebar names `polls` / `events` / `docs` and the superseded `board` slug restore as `#tools` (plus shelf mode when applicable). Unknown tools modes reset to `polls`.

**Status vs Settings.** Status is for frequently needed operational info: Checklist, live Proposals. Settings is for one-time or occasional config, split across You / About / Network. Privilege role manage lives on **Crew** (not Settings). Network retargeting for future deploys lives in Settings → Network ([`docs/wallet/CHAIN_CONFIG.md`](../wallet/CHAIN_CONFIG.md)). Unknown persisted governance modes (including the former `stickers` and `roles` slugs) reset to `status`. Arbitrary contract allowlist / call UI is not on Settings.

**Invariant:** do not add a new `#governance` segmented mode for a single feature (including Wargame). Occasional config goes in a Settings **section**. A new tab is only for a frequently used operational domain with its own data (Governance, Treasury, Crew). Hats tree lives under Governance, not its own tab. Stickers must not be a sidebar channel or a `#governance` mode — pack authoring lives under `#tools` Stickers with polls / events / docs.

**Keep-alive:** After a `#governance` mode is visited once, `SquadGovernanceView` keeps that tab mounted and toggles visibility with `hidden`/CSS so form and sub-mode state survive mode switches (avoids remount races on Mutiny / QM / Safe loaders). Separate keep-alive instances exist per Live vs Wargame stack. `#settings` and `#tools` use the same keep-alive for their mode panes. Shared chrome: `HubViewShell` (`HubChannelHeader` + optional stack switcher + `HubModeSwitcher` + `ParentDashboardMembersPanel`).

Governance uses role sub-modes inside `PactoGovGovernanceShell` (All / Crew / Captain command panes; Status owns the Proposals board). The board filters **Open | Executed | Failed** for treasury proposals and mutiny rounds. Crew offboard and crew add/remove stay on Open only, and leave the board when they finish. Propose and vote-mode writes live on **All**; process votes live on Status cards. CTAs use **ACL** (access control) snapshots from `get_squad_capabilities` (`src/lib/governance/governance-privilege.ts`). Normative rules: [`docs/governance/ACCESS_CONTROL.md`](../governance/ACCESS_CONTROL.md).

---

## Related docs

- [`docs/communities/DESIGN.md`](../communities/DESIGN.md) — squads, squad-pairs, stable ids
- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — DM vs MLS transport
- [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md) — UI surface ≠ MLS bucket
- [`docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md) — wallet DM payloads routed by `DmMessageRouter`
- [`docs/wallet/ONCHAIN_READ_PATTERN.md`](../wallet/ONCHAIN_READ_PATTERN.md) — persist / hydrate / SWR (wallet; dashboard uses the same pattern)

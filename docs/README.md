# Pacto — contributor documentation

These docs are **tracked in git** and are the primary map for humans and coding agents: architecture, storage, messaging, and operational behavior.

| Area | Purpose |
|------|--------|
| **[svelte5-reference.md](./svelte5-reference.md)** | **Svelte 5 runes, patterns, events, snippets, TypeScript, and migration notes** for frontend development |
| **[BEADS.md](./BEADS.md)** | **Issue tracking with Beads (`bd`)**: install, sync, daily workflow, and DoltHub setup |
| **[CONCEPTS.md](../CONCEPTS.md)** | Shared vocabulary / acronyms (npub, MLS, roster EVM, ACL, …) |
| **[security/CRYPTOGRAPHY.md](./security/CRYPTOGRAPHY.md)** | **PIN-derived encryption, per-device salt, migration, and MLS encryption** (contributor/technical) |
| **[user/UNDERSTANDING_ENCRYPTION.md](./user/UNDERSTANDING_ENCRYPTION.md)** | **User-facing explanation of PIN, salt, and group encryption** (non-technical) |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | High-level system architecture, data flows, and layer responsibilities |
| **[messaging/OVERVIEW.md](./messaging/OVERVIEW.md)** | DM vs MLS: kinds, events, Tauri commands, frontend hooks |
| **[messaging/ATTACHMENTS.md](./messaging/ATTACHMENTS.md)** | Encrypted attachment uploads: Blossom blob vs media servers, host-visible metadata, caveats |
| **[messaging/STICKER_PACKS.md](./messaging/STICKER_PACKS.md)** | Squad sticker packs: MLS announce wire format, membership-based authorization, last-write-wins, encrypted Blossom storage |
| **[messaging/GIF_PROVIDER.md](./messaging/GIF_PROVIDER.md)** | Klipy GIF search: privacy disclosure, opt-in gate, single Rust egress chokepoint, `KLIPY_API_KEY` operator setup |
| **[privacy/TOR_TRANSPORT.md](./privacy/TOR_TRANSPORT.md)** | Optional Tor routing: single transport-gating layer, embedded Arti + local SOCKS proxy, setting lifecycle, manual verification checklist |
| **[messaging/SYNC_STATUS.md](./messaging/SYNC_STATUS.md)** | Gift-wrap backfill loop (modes, slices, events) and the header sync dot it drives |
| **[nostr/](./nostr/)** | Relay-facing behavior, rumor pipeline, module index |
| **[mls/](./mls/)** | MDK engine, storage split, invites, eviction & leave |
| **[storage-layout/](./storage-layout/)** | SQLite schema, paths, logout, local message encryption |
| **[communities/DESIGN.md](./communities/DESIGN.md)** | **Squads & in-app Networks**: shared MLS model, stable ids, invites, persistence |
| **[communities/JOIN_INBOX.md](./communities/JOIN_INBOX.md)** | Join inbox wire (`join_requests` virtual bucket) |
| **[design-system/](./design-system/)** | **UI design system**: theming tokens, shell regions, MUST/SHOULD/NEVER, decisions ([README](./design-system/README.md)) |
| **[shell/LAYOUT.md](./shell/LAYOUT.md)** | **Logged-in shell**: page layout, store slices, lib modules, dashboard/DM routers |
| **[dashboard/POLLS.md](./dashboard/POLLS.md)** | Dashboard polls: MLS announcements transport, replica, vote rules |
| **[dashboard/ASSET_CARDS.md](./dashboard/ASSET_CARDS.md)** | Sponsor / Treasury / vault card chrome (`DashboardAssetCard`) |
| **[legacy-fixes/](./legacy-fixes/)** | Alpha-only repair and migration paths to remove before beta or public v1 ([catalog](./legacy-fixes/CATALOG.md)) |
| **[wallet/](./wallet/)** | Embedded EVM wallet, RPC, chain config, DM payment messages ([on-chain read pattern](./wallet/ONCHAIN_READ_PATTERN.md)) |
| **[governance/ACCESS_CONTROL.md](./governance/ACCESS_CONTROL.md)** | Nostr↔EVM roster **ACL** (access control): Hats / Squad Admin capabilities, fail-closed signing preflight |
| **[governance/WAR_GAME_MODE.md](./governance/WAR_GAME_MODE.md)** | War-game vs production gov: coexistence, timings, `squad-wargame` |
| **[CHAIN_TERMINOLOGY.md](./CHAIN_TERMINOLOGY.md)** | Canonical network keys (`local`, not `anvil`); one spelling per chain |
| **[i18n.md](./i18n.md)** | Locale catalogs (`en`/`es`); Spanish **escuad** slang for Squad |
| **[RUNTIME_CONFIG.md](./RUNTIME_CONFIG.md)** | Backend-owned `AppConfig` limits/flags over Tauri IPC: source of truth, Zod validation, fallback behavior, how to add a new limit |
| **[audits/](./audits/)** | **Alpha / no external audit:** wallet and key-handling assurance posture ([README](./audits/README.md)) |
| **[build/](./build/)** | Desktop build guides (macOS, Windows, Ubuntu); [OPERATOR_UPDATES.md](./build/OPERATOR_UPDATES.md) covers signed in-app updates and the [mandatory update gate](./build/OPERATOR_UPDATES.md#marking-a-release-as-breaking); [DEV_SANDBOX.md](./build/DEV_SANDBOX.md) covers the debug-only dev-world data-directory refusal |
| **[testing/](./testing/)** | Test coverage status and backend phased testing plan ([README](./testing/README.md)) |

**Cross-cutting:**
- Strategy: **[`STRATEGY.md`](../STRATEGY.md)** — what the product is, who it serves, and where the team is investing
- Vocabulary: **[`CONCEPTS.md`](../CONCEPTS.md)** — shared terms for humans and coding agents
- System architecture: **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — high-level data flows and layer responsibilities

## Conventions

- **Greenfield:** No public alpha yet — prefer **breaking, slim changes** over compatibility layers for superseded designs. Agents and contributors: [`.cursor/rules/greenfield-no-legacy.mdc`](../.cursor/rules/greenfield-no-legacy.mdc).
- **Code wins:** If this tree disagrees with `src-tauri/src/` or `src/`, treat the code as source of truth and update the doc.
- **Chain names:** One canonical key per network (`local`, not `anvil`). See [`CHAIN_TERMINOLOGY.md`](./CHAIN_TERMINOLOGY.md).
- **Product name:** User-facing copy says **Pacto**. Some Rust comments still say “Vector” for historical reasons.

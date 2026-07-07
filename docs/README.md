# Pacto — contributor documentation

These docs are **tracked in git** and are the primary map for humans and coding agents: architecture, storage, messaging, and operational behavior.

| Area | Purpose |
|------|---------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | High-level system architecture, data flows, and layer responsibilities |
| **[messaging/OVERVIEW.md](./messaging/OVERVIEW.md)** | DM vs MLS: kinds, events, Tauri commands, frontend hooks |
| **[nostr/](./nostr/)** | Relay-facing behavior, rumor pipeline, module index |
| **[mls/](./mls/)** | MDK engine, storage split, invites, eviction & leave |
| **[storage-layout/](./storage-layout/)** | SQLite schema, paths, logout, local message encryption |
| **[communities/DESIGN.md](./communities/DESIGN.md)** | **Squads & in-app Networks**: shared MLS model, stable ids, invites, persistence |
| **[shell/LAYOUT.md](./shell/LAYOUT.md)** | **Logged-in shell**: page layout, store slices, lib modules, dashboard/DM routers |
| **[dashboard/POLLS.md](./dashboard/POLLS.md)** | Dashboard polls: MLS announcements transport, replica, vote rules |
| **[legacy-fixes/](./legacy-fixes/)** | Alpha-only repair and migration paths to remove before beta or public v1 ([catalog](./legacy-fixes/CATALOG.md)) |
| **[wallet/](./wallet/)** | Embedded EVM wallet, RPC, chain config, DM payment messages ([on-chain read pattern](./wallet/ONCHAIN_READ_PATTERN.md)) |
| **[CHAIN_TERMINOLOGY.md](./CHAIN_TERMINOLOGY.md)** | Canonical network keys (`local`, not `anvil`); one spelling per chain |
| **[audits/](./audits/)** | **Alpha / no external audit:** wallet and key-handling assurance posture ([README](./audits/README.md)) |
| **[build/](./build/)** | Desktop build guides (macOS, Windows, Ubuntu) |
| **[testing/](./testing/)** | Test coverage status and backend phased testing plan ([README](./testing/README.md)) |

**Cross-cutting:**
- Strategy: **[`STRATEGY.md`](../STRATEGY.md)** — what the product is, who it serves, and where the team is investing
- Vocabulary: **[`CONCEPTS.md`](../CONCEPTS.md)** — shared terms for humans and coding agents
- System architecture: **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — high-level data flows and layer responsibilities

**Design specs (`ai-docs/`):** governance + dashboard architecture notes live under [`../ai-docs/gov-core/`](../ai-docs/gov-core/README.md) (ModPol channels, single-group MLS virtual defaults, governance library). Shell refactor history: [`../ai-docs/shell-refactor/SHELL_MODULARIZATION_PLAN.md`](../ai-docs/shell-refactor/SHELL_MODULARIZATION_PLAN.md). **UX speed backlog:** [`../ai-docs/speed/UX_SPEED_AND_DATA_READ_PLAN.md`](../ai-docs/speed/UX_SPEED_AND_DATA_READ_PLAN.md).

## Conventions

- **Greenfield:** No public alpha yet — prefer **breaking, slim changes** over compatibility layers for superseded designs. Agents and contributors: [`.cursor/rules/greenfield-no-legacy.mdc`](../.cursor/rules/greenfield-no-legacy.mdc).
- **Code wins:** If this tree disagrees with `src-tauri/src/` or `src/`, treat the code as source of truth and update the doc.
- **Chain names:** One canonical key per network (`local`, not `anvil`). See [`CHAIN_TERMINOLOGY.md`](./CHAIN_TERMINOLOGY.md).
- **Product name:** User-facing copy says **Pacto**. Some Rust comments still say “Vector” for historical reasons.

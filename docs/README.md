# Pacto — contributor documentation

These docs are **tracked in git** and are the primary map for humans and coding agents: architecture, storage, messaging, and operational behavior.

| Area | Purpose |
|------|---------|
| **[messaging/](./messaging/)** | DM vs MLS: kinds, events, Tauri commands, frontend hooks |
| **[nostr/](./nostr/)** | Relay-facing behavior, rumor pipeline, module index |
| **[mls/](./mls/)** | MDK engine, storage split, invites, eviction & leave |
| **[storage-layout/](./storage-layout/)** | SQLite schema, paths, logout, local message encryption |
| **[communities/](./communities/)** | **Squads & in-app Networks**: shared MLS model, stable ids, invites, persistence |
| **[legacy-fixes/](./legacy-fixes/)** | Alpha-only repair and migration paths to remove before beta or public v1 ([catalog](./legacy-fixes/CATALOG.md)) |
| **[wallet/](./wallet/)** | Embedded EVM wallet, RPC, chain config, DM payment messages ([on-chain read pattern](./wallet/ONCHAIN_READ_PATTERN.md)) |
| **[audits/](./audits/)** | **Alpha / no external audit:** wallet and key-handling assurance posture ([README](./audits/README.md)) |
| **[build/](./build/)** | Desktop build guides (macOS, Windows, Ubuntu) |

## Conventions

- **Code wins:** If this tree disagrees with `src-tauri/src/` or `src/`, treat the code as source of truth and update the doc.
- **Product name:** User-facing copy says **Pacto**. Some Rust comments still say “Vector” for historical reasons.

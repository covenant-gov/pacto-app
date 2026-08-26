# Shell

App chrome regions and ownership. Describes the **current** production layout and reusable presentational shell.

Current logged-in map (stores, libs, dashboards): [docs/shell/LAYOUT.md](../shell/LAYOUT.md).

## Four regions

Visual model (Discord-style):

| Region | Role |
|--------|------|
| **Rail** | Narrow squad / top-level identity switcher |
| **Sidebar** | Channels, DMs, or section nav for the active context |
| **Main** | Primary content (chat, dashboard, settings) |
| **Aside** | Optional detail (members, wallet, inspectors) |

Production today mounts its legacy chrome through `src/routes/+page.svelte` and layout components (`ParentNavbar`, chat views, wallet sidebar). The reusable shell under `src/components/shell/` is currently mounted only by the development sandbox; production wiring is a later adapter. CSS class `.app-shell` on the legacy `<main>` remains unrelated to the component API.

## Responsive rules

Window minimum (Tauri): `minWidth` / `minHeight` **400** (`src-tauri/tauri.conf.json`). Design for a real desktop webview, including that floor.

Reusable shell breakpoints (`matchMedia`):

| Mode | Query | Grid | Drawers |
|------|-------|------|---------|
| **Wide** | default / above 1180px | Rail + sidebar + main + aside (if present) | None. Wide aside can collapse; main grows. Reopen from the main header control. |
| **Medium** | `max-width: 1180px` | Rail + sidebar + main | Aside (if present) as a right drawer |
| **Narrow** | `max-width: 720px` | Compact rail + main | Channel sidebar as a left drawer; aside as a right drawer |

The rail stays in the grid at every width. Only channel and member regions move into drawers. Identity row is a muted shelf (`bg-muted` / `--bg-panel`); thread is page fill (`bg-background` / `--bg-page`); no hairline under the 48px bars. The thread’s top-left uses `rounded-tl-lg` so the muted panel wraps the canvas at `--radius`.

Drawers:

- Mount drawer content only while that drawer is open and its region is not in the grid.
- Trap focus while open. Return focus to the opener on close. Do not mark the opener `inert` / `aria-hidden`.
- `overscroll-behavior: contain` on drawer surfaces.
- Honor `prefers-reduced-motion` for open/close (opacity/transform only). Cheap dim overlay; no backdrop blur.

Prefer **CSS Grid** for the structural shell. Avoid flex percentage math for column widths.

Full height: `html`/`body` are `height: 100%` with `overflow: hidden`. Fill with `h-full` / `min-h-0` flex children. Do not use marketing `h-screen` / `100dvh` hero patterns.

## Ownership (current)

| Layer | Owns |
|-------|------|
| `src/routes/+page.svelte` | Top layout, tab routing; stays a legacy shell — carve new UI into child components |
| `src/components/layout/*`, `parent/*`, `dm/*`, … | Feature chrome and product UI |
| `src/stores/*` | Domain state (`svelte/store`) |
| `src/lib/*` | Side effects, Tauri wrappers, pure helpers |
| `src/lib/components/ui` | shadcn primitives |

Invariant from LAYOUT.md: components bind UI and call libs; avoid new cross-cutting logic in `+page.svelte` or monolithic stores.

## Component placement

| Kind | Path | Notes |
|------|------|-------|
| shadcn primitives | `src/lib/components/ui` | Add via shadcn-svelte; aliases in `components.json` |
| Existing product widgets | `src/components/ui` | RefreshIconButton, EditIconButton, Modal, Toast, … — **no new shared primitives here** |
| Feature UI | `src/components/{auth,dm,channel,parent,wallet,…}` | Domain folders |
| Presentational shell | `src/components/shell` | Layout-only; no stores, no Tauri, no fixtures |
| Shell types | `src/lib/shell` | Props / region types and pure view helpers |

## State rules

- Loading / empty / error / dense states are required for new UI surfaces.
- URL state SHOULD reflect filters/tabs where the app already deep-links; this is a SvelteKit static SPA in a Tauri webview, not a multi-page marketing site.
- Do not put store subscriptions or `invoke` inside shared presentational shell components.

See [decisions/0002-shell-data-boundary.md](./decisions/0002-shell-data-boundary.md).

## Reusable shell and sandbox

Implemented:

1. **`src/components/shell/`** — presentational regions. `/design` mounts `AppShell` plus `Design*` wrappers around `RailTile`, `ChannelRow`, and `PresenceAvatar` so the sandbox can add playground-only chrome (add/leave, context menus). `NavRail`, `ChannelSidebar`, and `MemberSidebar` are the production-shaped composites for the future adapter; they are not swapped into the sandbox because they do not accept that extra chrome.
2. **`src/lib/shell/`** — shared types and pure helpers for shell views.
3. **`src/routes/design/`** — development-only fixture sandbox for themes, responsive layouts, and preview states. It has no production stores, Tauri calls, or live account data. `vite build` / Tauri release bundles omit the route (stash `src/routes/design` for the compile). It is served by `pnpm dev` / `pnpm tauri:dev`. Override with `PACTO_INCLUDE_DESIGN=1`.

Still planned:

4. **Production adapter** — a thin route/layout edge that maps real stores into the same presentational props.

Boundary rules:

- Shared shell components stay presentational.
- Fixtures live only under the design sandbox route.
- Production data stays in stores / lib; adapter composes props.

Sandbox-only encode (not production chrome):

- Dither CSS and SVG masks live in `src/routes/design/` (`dither.css`, `dither/*.svg`). Do not put mask `url()`s in `src/app.css`.
- Inherited custom properties that contain `url(...)` do **not** paint as `mask-image` on `::before` (Chromium/WebKit). Use a `data-dither-pattern` ancestor and literal `url()` in the matching rule.
- Unread `RailTile` `variant="squad"` stays encoded until hover / focus-visible / `data-active`. The selected tile is decoded.
- The sealed gate is a full overlay with a radial knockout and a page-color well. Do not wrap lock chrome in a card. PIN wells are floating; copy sits on `--text-primary`.

## Related

- [docs/shell/LAYOUT.md](../shell/LAYOUT.md)
- [UI.md](./UI.md)

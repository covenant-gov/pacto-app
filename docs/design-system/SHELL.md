# Shell

App chrome regions and ownership. Describes **current** production layout and the **planned** presentational shell. The planned pieces are not shipped yet.

Current logged-in map (stores, libs, dashboards): [docs/shell/LAYOUT.md](../shell/LAYOUT.md).

## Four regions

Visual model (Option I / Discord-style):

| Region | Role |
|--------|------|
| **Rail** | Narrow squad / top-level identity switcher |
| **Sidebar** | Channels, DMs, or section nav for the active context |
| **Main** | Primary content (chat, dashboard, settings) |
| **Aside** | Optional detail (members, wallet, inspectors) |

Production today mounts these through `src/routes/+page.svelte` and layout components (`ParentNavbar`, chat views, wallet sidebar). There is **no** shared `AppShell` package yet. CSS class `.app-shell` on `<main>` is a flex row that fills window height — not the future component API.

## Responsive rules

Window minimum (Tauri): `minWidth` / `minHeight` **400** (`src-tauri/tauri.conf.json`). Design for a real desktop webview, including that floor.

Planned breakpoints (for future shell work):

| Mode | Behavior |
|------|----------|
| **Wide** | Rail + sidebar + main + aside (if open) visible |
| **Medium** | Collapse one secondary region; prefer drawers for aside or sidebar |
| **Narrow** | Rail/sidebar become drawers; **main keeps a usable min width** |

Drawers:

- Trap focus while open.
- Return focus to the opener on close.
- `overscroll-behavior: contain` on drawer surfaces.
- Honor `prefers-reduced-motion` for open/close (opacity/transform only).

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
| Presentational shell (planned) | `src/components/shell` | Layout-only; no stores, no Tauri, no fixtures |
| Shell types (planned) | `src/lib/shell` | Props / region types only |

## State rules

- Loading / empty / error / dense states are required for new UI surfaces.
- URL state SHOULD reflect filters/tabs where the app already deep-links; this is a SvelteKit static SPA in a Tauri webview, not a multi-page marketing site.
- Do not put store subscriptions or `invoke` inside shared presentational shell components (once they exist).

See [decisions/0002-shell-data-boundary.md](./decisions/0002-shell-data-boundary.md).

## Phase 4 plan (not implemented)

Do not treat these as present:

1. **`src/components/shell/`** — presentational regions (rail, sidebar, main, aside, drawers).
2. **`src/lib/shell/`** — shared types for region props.
3. **`src/routes/design/`** — fixture-only sandbox to exercise the shell with static data. No production stores, no Tauri, no live account.
4. **Production adapter** — a later thin route/layout that wires real stores into the same presentational shell.

Rules for that work:

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
- Non-normative Option I HTML: [reference/option-i.html](./reference/option-i.html)

# 0002 — Shell data boundary

## Context

The logged-in app mixes layout chrome with stores, Tauri `invoke`, and domain loaders (see `docs/shell/LAYOUT.md`). The shared shell (rail / sidebar / main / aside) must stay reusable for:

- production (real stores), and
- a fixture-only design sandbox (`src/routes/design/`).

If shell components import stores or fixtures directly, the sandbox and production paths couple and tests become brittle.

## Decision

1. **Presentational shell** (`src/components/shell`) receives props / snippets only. No Svelte stores, no Tauri, no fixture modules inside those components.
2. **Types and pure helpers** live in `src/lib/shell`.
3. **Fixtures and design catalogs** stay under `src/routes/design/` only. Shared shell never imports them. Design locale files must not be eager-globbed by `src/lib/i18n`.
4. **Production adapter** (later) maps stores → shell props at the route/layout edge.
5. Until that adapter ships, production chrome remains as documented in `docs/shell/LAYOUT.md`. The reusable shell is mounted only by the design sandbox.

## Consequences

- Design sandbox can swap fixtures without touching production wiring.
- Feature UI stays in domain folders; shell stays layout chrome.
- New shared primitives continue to go to `src/lib/components/ui` (shadcn), not into shell or old `src/components/ui` primitive dumps.
- Crossing this boundary (store import inside presentational shell) needs a new decision — prefer not to.

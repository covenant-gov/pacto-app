# Design system

Stable rules for UI in this **Tauri v2 + SvelteKit (Svelte 5)** desktop app.

Read this tree before changing themes, shell layout, or shared UI.

## Start here

| Doc | Use when |
|-----|----------|
| [THEMING.md](./THEMING.md) | Tokens, fonts, adding a skin |
| [SHELL.md](./SHELL.md) | App regions, ownership, future shell |
| [UI.md](./UI.md) | MUST / SHOULD / NEVER for interactions and taste |
| [MOTION.md](./MOTION.md) | CSS vs `svelte/motion` vs `svelte/transition` (which tool) |
| [decisions/](./decisions/) | Why token or shell contracts changed |
| [reference/](./reference/) | Non-normative visual history |

Live production shell map (stores, libs, dashboards): [docs/shell/LAYOUT.md](../shell/LAYOUT.md).

## Stack (facts)

- UI primitives: **shadcn-svelte** under `src/lib/components/ui` (`components.json`).
- Icons: `@lucide/svelte`.
- Fonts: Instrument Sans (`--font-ui`); JetBrains Mono (`--font-mono-family`) for keys, addresses, chain IDs, technical data.
- Themes: `[data-theme="<id>"]` on `<html>`. Registry: `src/stores/theme.ts`.
- New `.svelte` files: Svelte 5 runes (`$props`, `$state`, `$derived`). No `export let` / `on:` / slots in new files.
- Stores stay on `svelte/store`. Do not convert store modules to runes.
- Full height: fill the Tauri window with `h-full` / flex. Do not use marketing `h-screen` heroes.

## Where components go

| Kind | Path |
|------|------|
| Shared primitives (shadcn) | `src/lib/components/ui` |
| Product widgets already there | `src/components/ui` (Refresh/Edit icon buttons, Modal, Toast, …) — do not add new shared primitives here |
| Feature UI | `src/components/{auth,dm,channel,parent,wallet,…}` |
| Presentational shell (planned) | `src/components/shell` — see [SHELL.md](./SHELL.md) |

## Change rules

- Token **meaning** changes need a new decision record under `decisions/`.
- Theme **values** stay in `src/styles/themes/<id>.css` and must pass `theme-tokens.test.ts`.
- Do not invent token names that contradict current CSS. Read `src/app.css` and theme files first.
- Prefer existing Pacto tokens (`--brand`, `--bg-*`, `--text-*`). Do not invent a parallel gray scale.

## Related

- Svelte 5 patterns: [docs/svelte5-reference.md](../svelte5-reference.md)
- Docs index: [docs/README.md](../README.md)

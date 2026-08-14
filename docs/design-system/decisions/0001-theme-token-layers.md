# 0001 — Theme token layers: `--brand` vs shadcn `--accent`

## Context

shadcn-svelte primitives expect tokens named `--primary`, `--accent`, and friends. Pacto already had product tokens (`--brand`, `--bg-hover`, …) and multiple skins under `[data-theme]`.

If theme files define their own `--accent` as “brand color,” primitives and hover surfaces fight each other. Contributors also confuse “accent” (marketing speak) with hover chrome.

## Decision

1. **Pacto owns color meaning** in `src/styles/themes/<id>.css` (`--brand`, `--bg-*`, `--text-*`, …).
2. **`src/app.css` maps once** into shadcn names:
   - `--primary` → `--brand`
   - `--primary-foreground` → `--on-brand`
   - `--accent` → `--bg-hover`
   - `--accent-foreground` → `--text-primary`
3. Theme files **must not** declare `--accent`, `--accent-hover`, or `--accent-contrast`.
4. Text on brand fills uses `--on-brand` only.
5. Tailwind `dark:` is bound to dark `[data-theme=…]` ids via `@custom-variant`, not a `.dark` class.

## Consequences

- Filled brand buttons: `bg-primary text-primary-foreground` or `var(--brand)` / `var(--on-brand)`.
- Hover rows and subtle highlights: `bg-accent` means hover surface, **not** brand paint.
- Adding a skin means filling the Pacto required list; the alias layer stays untouched.
- Changing this mapping requires a new decision record and test updates in `theme-tokens.test.ts`.

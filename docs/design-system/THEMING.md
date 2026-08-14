# Theming

How skins and tokens work in this app. Match the code: `src/app.css`, `src/styles/themes/*.css`, `src/stores/theme.ts`, `src/app.html`, `src/styles/themes/theme-tokens.test.ts`.

## Layers

```
Theme CSS ([data-theme] / :root)
  → Pacto tokens (--brand, --bg-*, --text-*, …)
  → shadcn aliases in app.css (--primary, --accent, …)
  → Tailwind @theme inline (--color-primary, …)
  → Components (bg-primary, text-primary-foreground, …)
```

1. **Pacto tokens** — owned by each theme file. Source of truth for color.
2. **shadcn aliases** — mapped once in `src/app.css`. Do not redefine them inside theme files.
3. **Typography / radius / ease** — shared on `:root` in `src/app.css` (not per theme).

Skins use `[data-theme="<id>"]` on `<html>`. There is **no** `.dark` class. Tailwind `dark:` utilities use `@custom-variant dark` in `app.css`, keyed to dark theme ids (not `techno`).

## Required Pacto tokens

Every theme file must define these (enforced by `theme-tokens.test.ts`):

| Token | Role |
|-------|------|
| `--bg-page` | Window / page background |
| `--bg-panel` | Panels, muted surfaces |
| `--bg-elevated` | Raised surfaces, popovers/secondary |
| `--bg-hover` | Hover / selected-adjacent surface |
| `--text-primary` | Body and strong text |
| `--text-secondary` | Secondary copy |
| `--text-muted` | Hints, meta |
| `--border` | Strong borders |
| `--border-subtle` | Dividers, inputs |
| `--brand` | Brand fill and focus ring source |
| `--brand-hover` | Brand hover |
| `--on-brand` | Text/icons **on** brand fills |
| `--danger` | Destructive |
| `--success` | Success (not brand) |
| `--warning` | Warning |

Also set `color-scheme: dark;` or `color-scheme: light;` to match the skin.

Theme files **must not** define `--accent`, `--accent-hover`, `--accent-contrast`, or `--bg-secondary` (legacy names; tests fail if present).

Themes may add product-local tokens (e.g. `--channel-active-bg`, commons tile scrims). Prefer Pacto names for shared UI.

## Pacto tokens vs shadcn aliases

Mapped in `src/app.css` under `:root, [data-theme]`:

| shadcn | Pacto |
|--------|-------|
| `--background` | `--bg-page` |
| `--foreground` | `--text-primary` |
| `--card` | `--bg-panel` |
| `--card-foreground` | `--text-primary` |
| `--popover` | `--bg-elevated` |
| `--popover-foreground` | `--text-primary` |
| `--primary` | `--brand` |
| `--primary-foreground` | `--on-brand` |
| `--secondary` | `--bg-elevated` |
| `--secondary-foreground` | `--text-primary` |
| `--muted` | `--bg-panel` |
| `--muted-foreground` | `--text-muted` |
| `--accent` | `--bg-hover` |
| `--accent-foreground` | `--text-primary` |
| `--destructive` | `--danger` |
| `--destructive-foreground` | `--text-primary` |
| `--input` | `--border-subtle` |
| `--ring` | `--brand` |

Important:

- **Brand** is `--brand` / shadcn `--primary`. Use for filled CTAs and brand chrome.
- **shadcn `--accent`** is the **hover surface** (`--bg-hover`), not brand color. Do not put brand hex in `--accent`.
- Text on brand fills: `color: var(--on-brand)` (or `text-primary-foreground`). No hex fallback. Do not invent `--text-on-accent`.
- Success text uses `--success`, not `--brand`.
- Hover surfaces use `--bg-hover`. Static elevated surfaces use `--bg-elevated`.
- `--bg-tertiary` is undefined. Do not use it.

See [decisions/0001-theme-token-layers.md](./decisions/0001-theme-token-layers.md).

## Contrast

`--on-brand` on `--brand` must stay readable. Tests require WCAG contrast ratio ≥ 4.5 for the hex pair in each theme file.

Prefer APCA for new visual review when tools allow. Raise contrast on `:hover` / `:active` / `:focus` states.

## Fonts

Defined in `src/app.css`:

| Variable | Stack | Use |
|----------|-------|-----|
| `--font-ui` | Instrument Sans, system sans | UI and headings |
| `--font-mono-family` | JetBrains Mono, then `ui-monospace`, … | Keys, addresses, chain IDs, technical data |

Tailwind:

- `--font-sans` → `--font-ui`
- `--font-mono` → `--font-mono-family`

Prefer `font-mono` / `var(--font-mono-family)` for technical mono. Some local `ui-monospace` stacks remain in older CSS; do not spread new ones.

WOFF2 files live under `static/fonts/` and load via `@font-face` in `app.css`.

## Spacing, radius, motion

| Token | Where | Notes |
|-------|-------|-------|
| `--radius` | `:root` in `app.css` | Default `0.5rem`; Tailwind `--radius-sm/md/lg/xl` derive from it |
| `--ease-out` | `:root` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--notif` | `:root` | Notification badge color (shared) |

Spacing: use Tailwind spacing scale with token colors. Keep density moderate (app chrome, not marketing whitespace).

Motion: animate `transform` and `opacity` only. Honor `prefers-reduced-motion`. Prefer CSS over JS motion libraries. App also imports `tw-animate-css`.

## Registry and dark skins

`src/stores/theme.ts`:

- `THEME_OPTIONS` — `{ value, label }` list (ids must match CSS filenames).
- `DEFAULT_THEME` — currently `dark-techno`.
- `DARK_THEME_IDS` — skins that use `color-scheme: dark` and belong in the Tailwind `dark` variant list in `app.css`.
- Storage key: `pacto_theme` in `localStorage`.
- `setTheme` writes storage and sets `document.documentElement` `data-theme`.

Early load (no flash): inline script in `src/app.html` allowlists theme ids and defaults to `dark-techno`.

Default dark-techno also targets `:root` in its CSS file so the first paint has tokens before the attribute is set.

## How to add a theme

Do all of these. Miss one and flash, tests, or `dark:` utilities break.

1. **CSS** — create `src/styles/themes/<id>.css` with `[data-theme="<id>"] { … }` (and `:root,` only if this skin is the first-paint default).
2. Define every **required token** and the correct `color-scheme`.
3. **Import** in `src/app.css`: `@import './styles/themes/<id>.css';`
4. If the skin is dark, add it to the `@custom-variant dark (…)` selector list in `app.css`.
5. Append `{ value: '<id>', label: '…' }` to `THEME_OPTIONS` in `src/stores/theme.ts`.
6. If dark, append `'<id>'` to `DARK_THEME_IDS`.
7. Allow `<id>` in the early-load script in `src/app.html` (`t !== '<id>'` chain).
8. Run `pnpm test` (at least `theme-tokens.test.ts`) and fix contrast if `--on-brand` fails.

`components.json` points Tailwind CSS at `src/app.css`. No change needed for a normal new skin.

## Examples (live patterns)

Brand button text:

```css
.bg-brand-fill {
  background: var(--brand);
  color: var(--on-brand);
}
```

Or Tailwind: `bg-primary text-primary-foreground`.

Hover row (not brand):

```css
.row:hover {
  background: var(--bg-hover);
}
```

Or Tailwind: `hover:bg-accent` (because `--accent` → `--bg-hover`).

Technical id:

```html
<span class="font-mono text-sm text-muted-foreground">0xabc…</span>
```

## Current skins

| Id | Scheme | Notes |
|----|--------|-------|
| `techno` | light | Only light skin in registry |
| `dark-techno` | dark | Default; also on `:root` |
| `union` | dark | |
| `midnight` | dark | |
| `aztec` | dark | |

## Related

- Decision: [0001-theme-token-layers.md](./decisions/0001-theme-token-layers.md)
- Design-system index: [README.md](./README.md)

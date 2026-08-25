# UI guidelines

MUST / SHOULD / NEVER for general UI in this **Tauri desktop webview + SvelteKit SPA**.

Stack facts: Svelte 5 (runes for new files), shadcn-svelte primitives, `@lucide/svelte`, Pacto theme tokens. See [README.md](./README.md) and [THEMING.md](./THEMING.md).

Default taste dials: **DESIGN_VARIANCE=8**, **MOTION_INTENSITY=6**, **VISUAL_DENSITY=4**.

---

## Interactions

### Keyboard

- MUST: Full keyboard support per [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/).
- MUST: Visible focus rings (`:focus-visible`; group with `:focus-within`).
- MUST: Manage focus (trap, move, return) per APG — especially modals and drawers.
- NEVER: `outline: none` without a visible focus replacement.

### Targets and input

- MUST: Hit target ≥ **24px** on desktop. If the visual control is smaller, expand the hit area.
- MUST: Remember the window can be as small as **400×400**. Keep primary actions usable at that size.
- SHOULD: Prefer ≥16px text on compact inputs so small-window zoom stays sane.
- NEVER: Disable zoom with `user-scalable=no` / `maximum-scale=1` in shipped UI.
- SHOULD: `touch-action: manipulation` where touch/pen hits the webview.
- SHOULD: Match `-webkit-tap-highlight-color` to the surface.

### Forms

- MUST: Keep input focus and value stable across re-renders (Svelte bindings / controlled fields that do not remount on every keystroke).
- NEVER: Block paste in `<input>` / `<textarea>`.
- MUST: Loading buttons show a spinner and keep the original label.
- MUST: Enter submits a focused single-line field; in `<textarea>`, ⌘/Ctrl+Enter submits, Enter inserts a newline.
- MUST: Keep submit enabled until the request starts; then disable and show the spinner. Use an idempotency key for mutating submits when retries are possible.
- MUST: Accept free text while typing; validate after (blur/submit), do not block keystrokes.
- MUST: Allow submit of incomplete forms so validation can surface.
- MUST: Errors inline next to fields; on submit, focus the first error.
- MUST: Meaningful `name`; correct `type` / `inputmode`; use `autocomplete` where it helps password managers and 2FA.
- SHOULD: Disable spellcheck for emails, codes, usernames, hex addresses.
- SHOULD: Placeholders end with `…` and show an example pattern.
- MUST: Warn on unsaved changes before leaving a dirty form or closing a destructive flow.
- MUST: Allow pasting one-time codes and recovery phrases.
- MUST: Trim values when trailing spaces from text expansion would break validation.
- MUST: No dead zones on checkboxes/radios; label and control share one generous hit target.

### State and navigation

- SHOULD: Reflect UI state in the URL where the app already deep-links (tabs, selected squad/channel, modes).
- SHOULD: Back/forward restores scroll where the surface scrolls.
- MUST: Use real links (`<a>`) for navigations that should support open-in-new / middle-click when that applies.
- NEVER: Use a bare `<button>` for a navigation that should be a link.
- Note: This app is `adapter-static` SPA inside Tauri. There is no Next.js router. Do not require React `Link`.

### Feedback

- SHOULD: Optimistic UI when safe; reconcile on response; on failure roll back or offer Undo.
- MUST: Confirm destructive actions or provide a short Undo window.
- MUST: Polite `aria-live` for toasts and inline validation.
- SHOULD: Ellipsis character `…` for follow-up actions (“Rename…”) and loading copy (“Loading…”, “Saving…”).

### Touch and drag

- MUST: Generous targets; clear affordances; avoid finicky drag handles.
- MUST: Delay the first tooltip in a group; later peers can open with no delay.
- MUST: `overscroll-behavior: contain` in modals and drawers.
- MUST: During drag, disable text selection; set `inert` on dragged content when appropriate.
- MUST: If it looks clickable, it is clickable.

### Autofocus

- SHOULD: Autofocus on desktop when there is a single primary field (e.g. search, PIN). Rarely autofocus in dense multi-field forms.

---

## Animation

- MUST: Honor `prefers-reduced-motion` (reduced variant or disable).
- SHOULD: Prefer CSS, then Web Animations API; avoid heavy motion libraries unless already in the tree.
- MUST: Animate compositor-friendly props only: `transform`, `opacity`.
- NEVER: Animate layout props (`top`, `left`, `width`, `height`) for UI chrome motion.
- NEVER: `transition: all` — list properties explicitly.
- SHOULD: Animate to clarify cause/effect or deliberate delight — not decoration spam.
- SHOULD: Easing matches the change (`--ease-out` is available).
- MUST: Animations are interruptible and input-driven (no endless autoplay chrome).
- MUST: Correct `transform-origin`.
- Default intensity: dial **6** — fluid CSS transitions; not cinematic scroll theater.

Which tool (CSS vs `svelte/motion` vs `svelte/transition`): [MOTION.md](./MOTION.md).

---

## Layout

- SHOULD: Optical alignment; ±1px when perception beats geometry.
- MUST: Deliberate alignment to grid / baseline / edges.
- SHOULD: Balance icon/text lockups (stroke, weight, size, color).
- MUST: Verify wide, medium, and narrow window widths (including ~400px min).
- MUST: Avoid unwanted scrollbars; fix overflows (`min-w-0` on truncating flex children).
- SHOULD: CSS Grid for structural shell columns; avoid flex percentage math.
- MUST: Fill the Tauri window with `h-full` / flex + `min-h-0`. NEVER treat the app as a marketing `h-screen` hero page.
- Default density: dial **4** — standard app density, not sparse landing pages.

---

## Content and accessibility

- SHOULD: Inline help first; tooltips last resort.
- MUST: Skeletons mirror final content to limit layout shift.
- MUST: Document / window title matches current context when the surface owns it.
- MUST: No dead ends; always offer a next step or recovery.
- MUST: Design empty, sparse, dense, and error states for new surfaces.
- SHOULD: Curly quotes (“ ”); `text-wrap: balance` on headings where useful.
- MUST: `font-variant-numeric: tabular-nums` (or mono) for comparable numbers.
- MUST: Redundant status cues — not color-only. Icons need accessible names or visible text.
- MUST: Accessible names exist even when the visual omits a label.
- MUST: Use the ellipsis character `…` (not three ASCII dots) in UI copy.
- MUST: Hierarchical headings; `scroll-margin-top` on in-page targets when used.
- MUST: Resilient to user-generated content (short / average / very long).
- MUST: Locale-aware dates, times, numbers (`Intl.*`); user-facing strings go through i18n (`svelte-i18n`).
- MUST: Accurate `aria-label`; decorative elements `aria-hidden`.
- MUST: Icon-only buttons have a descriptive `aria-label` (use shared Refresh/Edit icon buttons for those actions).
- MUST: Prefer native semantics (`button`, `a`, `label`, `table`) before ARIA.
- SHOULD: Non-breaking spaces for glued units (`10 MB`, shortcut chords) in copy that must not wrap badly.

### Content handling

- MUST: Text containers handle long content (`truncate`, `line-clamp-*`, `break-words`).
- MUST: Flex children that truncate need `min-w-0`.
- MUST: Empty strings/arrays show an empty state — not a broken layout.

---

## Performance

- SHOULD: Profile with CPU throttling when chasing jank.
- MUST: Avoid unnecessary layout thrash; batch DOM reads/writes when touching measured layout.
- SHOULD: Keep controlled inputs cheap per keystroke.
- SHOULD: Virtualize large lists when row count is high enough to hurt scroll (message timelines, long rosters). Follow existing list patterns in the app; do not pull a React-only virtualizer.
- SHOULD: Lazy-load heavy media; reserve space to limit CLS.
- SHOULD: Critical fonts already use `font-display: swap` in `app.css` — keep that.

---

## Theming and contrast

- MUST: Dark skins set `color-scheme: dark` in theme CSS; light skins set `color-scheme: light`.
- MUST: Native form controls get explicit background and color when they sit on custom surfaces.
- MUST: Meet contrast. Prefer APCA when reviewing; theme tests enforce ≥ 4.5 for `--on-brand` on `--brand`.
- MUST: Increase contrast on `:hover` / `:active` / `:focus` relative to resting state when needed for visibility.
- MUST: Use Pacto tokens and shadcn aliases from [THEMING.md](./THEMING.md). NEVER invent a parallel gray scale or redefine `--accent` as brand.

---

## Svelte / architecture (taste, adapted)

- MUST: New `.svelte` files use runes (`$props`, `$state`, `$derived`). No `export let`, `on:`, or slots in new files.
- MUST: Leave `src/stores/*` on `svelte/store`. Read with `$store` from components.
- MUST: Icons from `@lucide/svelte` (consistent stroke). NEVER add Phosphor or Radix React icon packages.
- MUST: UI font Instrument Sans; technical mono JetBrains Mono via `--font-mono-family`.
- SHOULD: Check `package.json` before adding a dependency.
- MUST: Loading, empty, and error states on new interactive surfaces.
- SHOULD: Light press feedback on primary controls (`translate` / `scale` on transform only).

God shells (`+page.svelte`, `ChatView.svelte`, `ParentDashboard.svelte`) stay legacy. Carve new work into runes child components.

---

## Taste constraints

Dial variance **8**: allow controlled asymmetry in feature layouts; collapse to strict single column when the window is narrow.

- NEVER: Generic purple-on-white / purple-to-indigo AI chrome.
- NEVER: Neon outer glow stacks, pure `#000` fields, or glow-as-brand.
- NEVER: Rounded-full pill spam for every chip and tab.
- NEVER: Card wrappers when spacing or a divider is enough. Cards only when they hold an interaction. Full-bleed overlays (lock / gate) use a radial well, not a boxed panel.
- MUST: One job per section — one headline, short support copy.
- MUST: Use existing Pacto tokens; do not invent a new neutral scale.
- SHOULD: Nested radii — child ≤ parent.
- SHOULD: Tint borders toward the surface hue.
- Charts (if added): color-blind-safe palette; never color-only encoding.

---

## Sources

- [Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) — interaction, a11y, motion, layout, content rules adapted for a desktop webview.
- High-agency frontend taste adapted for **Svelte / Tauri** (not React/Next, not Framer Motion defaults, not Geist/Outfit, not Phosphor).

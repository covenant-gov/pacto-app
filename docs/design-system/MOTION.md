# Motion notes

Agent notes for the design-spec branch. **Tauri is not a constraint.** The webview runs the same CSS, WAAPI, `svelte/motion`, and `svelte/transition` as a browser.

MUST / SHOULD / NEVER live in [UI.md](./UI.md#animation). This file is **which tool**. API lookup: [svelte5-reference.md](../svelte5-reference.md) (`svelte/motion`, `prefersReducedMotion`).

Do not add Motion One, `svelte-motion`, or Framer. They are not in the tree. `svelte/motion` is built into Svelte 5.

## Inventory (do not mix these up)

| Tool | What it is | Use for |
|------|------------|---------|
| **CSS `transition`** | Interruptible; retargets mid-flight | Toggles, hover, open/close of **already-mounted** chrome |
| **`tw-animate-css`** (`animate-in` / `data-open:`) | Keyframe enter/exit tied to bits-ui `data-open` / `data-closed` | Overlays, dialogs, drawers, menus already on bits-ui |
| **`svelte/transition`** | `fly` / `fade` / `slide` on `{#if}` / `{#key}` | Element **mounts and unmounts**; one-shot enter/exit |
| **`svelte/motion`** | `Spring` / `Tween` (rAF, `.current` / `.set()`) | **Owned numeric values** that must settle, follow a pointer, or retarget with physics |

`svelte/motion` ≠ `svelte/transition`. Spring/Tween do not run outro when a node is destroyed. Transitions do not interpolate a number you hold in script.

## Decision

```
Is the node already in the DOM and flipping state (open, hover, collapsed)?
  yes → CSS transition on transform/opacity (and grid-template-columns only for shell split tracks)
  bits-ui overlay? → tw-animate-css on data-open / data-closed

Does the node mount/unmount and need a directed enter/exit?
  yes, and it is NOT bits-ui → svelte/transition (fly/fade)
  keep it mounted instead if unmount would collapse layout (see members column)

Do you own a number (x, opacity, progress) that should overshoot, follow, or retarget?
  yes → svelte/motion Spring (physics) or Tween (fixed duration)
```

Default for shell chrome: **CSS**. Reach for `svelte/motion` when CSS cannot express the curve (spring settle, gesture follow, interruptible value in script).

## CSS

Use for:

- Hover, focus, `aria-expanded` chip fills (including `--avatar-ring` knockout)
- Wide members column: keep the grid area mounted; interpolate the track `220px ↔ 0`; inner `opacity` + small `translateX`
- Anything users will reverse mid-animation (sidebar toggle, chevron rotate)
- `/design` rail encode: `opacity` on the tile `::before` (hover / active decode). Not `svelte/transition`. Gate scanlines are a static gradient, not a looping animation.

Rules:

- Properties: `transform`, `opacity`. Shell split panes may also transition `grid-template-columns` between two **length** tracks (`220px` / `0px`). Do not transition `width` / `height` / `top` / `left` of chrome.
- Easing: `ease-[var(--ease-out)]` (`--ease-out` in `src/app.css`). Not Tailwind `ease-out` (different curve).
- Duration: enter ~200ms, exit ~150ms. `motion-reduce:transition-none` (or `motion-reduce:animate-none`).
- Named transitions only. Never `transition: all`.

Example in tree: `src/components/shell/AppShell.svelte` (wide aside), `AsideToggleButton.svelte` (chevron + ring).

## svelte/motion

Works in Tauri. Use when the **value** is the animation:

- Spring: panel that should settle, drag/throw, stacked avatars that need to chase a changing count, a knob following the pointer
- Tween: script-driven progress (0→1) when CSS cannot bind to the source

Do **not** use Spring to drive `grid-template-columns` or element `width`. That is still layout animation; keep CSS on the track and, if you want a sprung feel, Spring only the inner `x` / `opacity`.

Always gate with `prefersReducedMotion` from `svelte/reactivity`: `.set(target, { duration: 0 })` or assign `.current` immediately.

```ts
import { Spring } from 'svelte/motion';
import { prefersReducedMotion } from 'svelte/reactivity';

const x = new Spring(0, { stiffness: 0.18, damping: 0.7 });

function open(next: boolean) {
	const to = next ? 0 : 8;
	if (prefersReducedMotion.current) x.current = to;
	else x.set(to);
}
```

## svelte/transition

Use for toast-like mounts, list rows that appear/disappear, one-shot content. Not for the docked members column: `{#if}` + `fly` unmounts the grid track and the main column snaps.

If bits-ui already owns presence (`data-closed:animate-out`), do not also wrap children in `transition:fly`.

Keep drawer **children rendered** while the dialog is closing so the CSS outro is not an empty shell (`AppShell` → `ShellDrawer`).

## Reduced motion

Every path honors `prefers-reduced-motion`:

- CSS: `motion-reduce:transition-none` / `motion-reduce:animate-none`
- JS: `prefersReducedMotion.current` from `svelte/reactivity`

No exceptions for “subtle” opacity-only chrome.

## Do not

- Add a motion library for one sheet
- `transition:fly` on a grid item whose absence changes `grid-template-areas`
- Animate layout to fake a drawer (use `transform` + overflow clip, or bits-ui)
- Mix Spring and CSS on the **same** property

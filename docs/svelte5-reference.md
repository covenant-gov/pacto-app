# Svelte 5 Quick Reference — Pacto Frontend Patterns

Terser form of the runes API. Use as a lookup, not a tutorial.
Covers the initial Svelte 5 release through **5.56.x**; newer minor additions are marked with the version they landed in.

---

## $state

```svelte
<script>
	let count = $state(0);          // reactive primitive
	let user = $state({ name: 'A' }); // reactive proxy (deep)
	let list = $state([1, 2, 3]);   // arrays are deep reactive

	// Assignment drives updates; mutation works because of Proxy
	function add() {
		list.push(list.length + 1);
	}

	// Replace whole value for raw / non-proxy behavior
	let raw = $state.raw({ x: 0 });
	function inc() {
		raw = { ...raw, x: raw.x + 1 };
	}

	// Snapshot for external APIs / console
	function save() {
		const plain = $state.snapshot(user);
		api.save(plain);
	}
</script>
```

Notes:
- `$state` returns a Proxy for objects/arrays. Read/write through it triggers updates.
- `$state.raw` disables deep reactivity — useful for large immutable data or non-reactive classes.
- `$state.snapshot` returns a plain, non-proxied copy.
- State must be declared at the top level of `<script>`, not inside functions/blocks.

---

## $derived

```svelte
<script>
	let count = $state(0);
	let doubled = $derived(count * 2);
	let parity = $derived(count % 2 === 0 ? 'even' : 'odd');

	let numbers = $state([1, 2, 3]);
	let total = $derived.by(() => numbers.reduce((a, b) => a + b, 0));
</script>
```

Notes:
- `$derived` tracks synchronously read dependencies.
- `$derived.by` for multi-step / side-effect-free computations.
- Never assign to state inside a `$derived` expression; use `$effect` or an event handler.
- Derived values are lazy and only recompute when read and dependencies changed.

---

## $effect

```svelte
<script>
	let query = $state('');
	let results = $state([]);
	let controller;

	$effect(() => {
		// cleanup previous run
		controller?.abort();
		controller = new AbortController();

		// read dependencies synchronously
		const q = query;
		if (!q) return;

		fetchResults(q, controller.signal).then(r => results = r);

		return () => controller.abort();
	});

	$effect.pre(() => {
		// runs before DOM updates; useful for measuring layout before paint
		const rect = el.getBoundingClientRect();
	});
</script>
```

Notes:
- `$effect` runs after DOM update; `$effect.pre` runs before.
- Return a cleanup function for subscriptions, intervals, event listeners, etc.
- Dependencies read asynchronously (inside `setTimeout`, `Promise`, callbacks) are NOT tracked.
- Do not synchronously mutate state inside the effect body — it causes infinite loops.

---

## $props

```svelte
<script lang="ts">
	interface Props {
		required: string;
		optional?: number;
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { required, optional = 0, class: klass, ...rest }: Props = $props();
</script>

<div class={klass} {...rest}>{required} — {optional}</div>
```

Notes:
- `$props()` replaces `export let` declarations.
- Default values in destructuring are NOT reactive once applied.
- Use `class: klass` or `class: className` because `class` is a reserved JS keyword.
- `children` is a reserved prop name for default snippet content.
- `...rest` is a plain object of remaining props; spread it onto an element.

---

## $bindable

```svelte
<!-- Input.svelte -->
<script lang="ts">
	interface Props {
		value?: string;
		disabled?: boolean;
	}

	let { value = $bindable(''), disabled = $bindable(false) }: Props = $props();
</script>

<input bind:value={value} bind:disabled={disabled} />

<!-- Parent.svelte -->
<script>
	let text = $state('hello');
	let locked = $state(false);
</script>

<Input bind:value={text} bind:disabled={locked} />
```

Notes:
- Mark prop as bindable with `$bindable(defaultValue)`.
- Parent can then use `bind:propName={state}` for two-way flow.
- Without `$bindable`, parent can pass value but not bind.

---

## $props.id()

```svelte
<script>
	const uid = $props.id();
</script>

<label for="{uid}-email">Email</label>
<input id="{uid}-email" type="email" />
```

Notes:
- Stable, instance-scoped ID; consistent SSR/hydration.
- Use for a11y attributes (`for`, `aria-labelledby`, `aria-describedby`).

---

## Event Handlers

```svelte
<script>
	let count = $state(0);
	let text = $state('');

	function onclick() {
		count++;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') submit();
	}
</script>

<!-- property form replaces on:click -->
<button {onclick}>clicks: {count}</button>

<!-- inline still ok -->
<button onclick={() => count--}>decrement</button>

<!-- events fire after bindings -->
<input bind:value={text} oninput={() => console.log(text)} />

<!-- capture variant -->
<div onclickcapture={() => console.log('captured')}>
	<button onclick={() => console.log('bubbled')}>click</button>
</div>
```

Notes:
- Use `onclick`, `oninput`, etc. as DOM properties.
- Shorthand `{onclick}` works when the variable is named exactly like the event property.
- No built-in event modifiers (`|preventDefault`, `|once`, `|stopPropagation`). Compose manually.
- `svelte/events` `on(element, type, handler)` returns a cleanup function and integrates with Svelte's event order.

---

## Manual Event Modifiers

```svelte
<script>
	function once(fn: (e: Event) => void) {
		let called = false;
		return (e: Event) => {
			if (called) return;
			called = true;
			fn(e);
		};
	}

	function preventDefault(fn: (e: Event) => void) {
		return (e: Event) => {
			e.preventDefault();
			fn(e);
		};
	}

	function stopPropagation(fn: (e: Event) => void) {
		return (e: Event) => {
			e.stopPropagation();
			fn(e);
		};
	}
</script>

<form onsubmit={preventDefault(submit)}>
	<button onclick={once(preventDefault(handler))}>once + prevent</button>
</form>
```

---

## Component Events → Callback Props

```svelte
<!-- Modal.svelte -->
<script lang="ts">
	interface Props {
		open?: boolean;
		onclose?: () => void;
		onconfirm?: (value: string) => void;
	}

	let { open = $bindable(false), onclose, onconfirm }: Props = $props();
</script>

{#if open}
	<div role="dialog">
		<button onclick={() => onclose?.()}>Close</button>
		<button onclick={() => onconfirm?.('ok')}>OK</button>
	</div>
{/if}

<!-- App.svelte -->
<script>
	import Modal from './Modal.svelte';

	let show = $state(false);
</script>

<button onclick={() => show = true}>open</button>
<Modal bind:open={show} onclose={() => show = false} onconfirm={(v) => alert(v)} />
```

Notes:
- `createEventDispatcher` is deprecated; pass callback props.
- Use optional chaining `onclose?.()` in case parent didn't provide handler.
- Bindable `open` lets parent sync state two ways while still allowing events.

---

## Snippets

```svelte
<!-- List.svelte -->
<script lang="ts">
	interface Props<T> {
		items: T[];
		row: import('svelte').Snippet<[T]>;
		empty?: import('svelte').Snippet;
		header?: import('svelte').Snippet;
	}

	let { items, row, empty, header }: Props<unknown> = $props();
</script>

{#if items.length}
	{#if header}
		<header>{@render header()}</header>
	{/if}
	<ul>
		{#each items as item}
			<li>{@render row(item)}</li>
		{/each}
	</ul>
{:else if empty}
	{@render empty()}
{/if}

<!-- App.svelte -->
<script>
	import List from './List.svelte';

	const users = $state([{ name: 'A' }, { name: 'B' }]);
</script>

<List items={users}>
	{#snippet header()}<h2>Users</h2>{/snippet}
	{#snippet row(user)}<span>{user.name}</span>{/snippet}
	{#snippet empty()}<p>No users.</p>{/snippet}
</List>
```

Notes:
- Snippets are scoped functions; render with `{@render name(args)}`.
- Children default is the `children` snippet prop.
- Optional snippet props: use `{#if children}` or `{@render header?.()}`.
- Export snippets via `<script module>` and import from other files.
- Recursive snippets are allowed.

---

## TypeScript Patterns

### Generic components

```svelte
<!-- List.svelte -->
<script lang="ts" generics="T">
	interface Props {
		items: T[];
		select: (item: T) => void;
	}

	let { items, select }: Props = $props();
</script>

{#each items as item}
	<button onclick={() => select(item)}>{item}</button>
{/each}
```

### Wrapper components

```svelte
<!-- Button.svelte -->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let { children, ...rest }: HTMLButtonAttributes = $props();
</script>

<button {...rest}>{@render children?.()}</button>
```

### Typing $state

```svelte
<script lang="ts">
	let count: number = $state(0);
	let user = $state<{ name: string; age?: number } | undefined>(undefined);
</script>
```

### Typing snippet props

```ts
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
	row: Snippet<[item: Item]>;
}
```

### Extending intrinsic elements

```ts
// additional-svelte-typings.d.ts
declare namespace svelteHTML {
	interface IntrinsicElements {
		'my-element': {
			foo: string;
			onbar?: (e: CustomEvent<string>) => void;
		};
	}
}
```

---

## Component Lifecycle / Mounting

```ts
import { mount, hydrate, unmount, flushSync } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
	target: document.getElementById('app')!,
	// props can be passed here too
});

// SSR
import { render } from 'svelte/server';
const { html, head, body } = render(App, { props: { message: 'hi' } });

// cleanup
unmount(app);
```

Notes:
- No more `new Component({ target, props })`.
- `mount`/`hydrate` are async at runtime; use `flushSync()` if you must synchronously trigger effects.
- `bind:this` no longer exposes `$set`, `$on`, `$destroy`.

---

## Svelte 4 → 5 Migration Cheatsheet

| Svelte 4 | Svelte 5 |
|----------|----------|
| `export let prop` | `let { prop } = $props()` |
| `let count = 0` (reactive in template) | `let count = $state(0)` |
| `$: doubled = count * 2` | `let doubled = $derived(count * 2)` |
| `$: { console.log(count) }` | `$effect(() => { console.log(count) })` |
| `on:click` | `onclick` property |
| `createEventDispatcher` | callback props |
| `\u003cslot /\u003e` / named slots | `children` snippet / named snippets |
| `\u003csvelte:component this={Thing} /\u003e` | `\u003cThing /\u003e` (dynamic components work directly) |
| `new Component({ target })` | `mount(Component, { target })` |
| `$on` / `$set` / `$destroy` | callback props / `$state` / `unmount` |
| `setContext('key', value)` / `getContext('key')` | `createContext\u003cT\u003e()` typed key |
| `\u003cdiv on:click|preventDefault\u003e` | manual `event.preventDefault()` or wrapper |
| `\u003cMyComponent let:item={item}\u003e` | snippet prop `\u003cMyComponent {item}\u003e` |
| Svelte stores for shared mutable state | `svelte/reactivity` classes or `$state` in `.svelte.ts` modules |

---

## Gotchas

1. **Props are not reactive inside child if you destructure from `$props()` without care?** Actually they are — but the destructured value itself is a local constant snapshot per update. Reassignments inside child do not flow up unless prop is `$bindable`.

2. **Mutating a `$state` object passed as a non-bindable prop works** but emits a dev warning because it violates ownership. Prefer `$bindable` or callback events.

3. **`$state` in classes** — class fields become reactive if initialized with `$state()`. Use arrow functions for methods that need stable `this`.

4. **`$effect` dependencies must be read synchronously** inside the effect body. Reading inside `await` or callbacks loses reactivity.

5. **Don't call `$state.snapshot` repeatedly in render** unless needed; it clones the value.

6. **Default props values** in destructuring are static fallbacks, not reactive. If parent passes a reactive value, it stays reactive.

7. **Reserved prop name `children`** — cannot use it for a non-snippet prop.

8. **Event delegation** — Svelte delegates most events. If you need non-passive or custom `addEventListener` ordering, use `svelte/events` `on()`.

9. **`$host()`** only works when component is compiled as a custom element (`<svelte:options customElement="..."/>`).

10. **Dot notation component**: `<foo.Bar />` is now treated as a component, not an HTML tag.

11. **Writable deriveds** (5.25.0) are possible but should be used sparingly; prefer `$state` for local mutable state.

12. **Class `class` attribute** supports object/array syntax (5.16.0). `clsx` is bundled.

13. **`createContext` is typed** (5.40.0). Use it instead of string/symbol keys for new code.

14. **Async components** require `experimental.async: true` and boundaries for robust loading/error UX.

15. **Template declarations** (`{@let ...}`, `{@const ...}`) are scoped to their block (5.56.0).

---

## $state.eager

```svelte
<script>
	let count = $state.eager(0);

	function bump() {
		// updates are applied synchronously/eagerly rather than batched
		count++;
	}
</script>
```

Notes:
- Added in 5.41.0. Eager state flushes updates immediately instead of batching.
- Use sparingly; normal `$state` batching is usually what you want.
- Useful when a consumer expects synchronous reads to reflect the latest value.

---

## $effect.pending()

```svelte
<script>
	let query = $state('');
	let loading = $state(false);

	$effect(() => {
		loading = true;
		fetch(`/api?q=${query}`).finally(() => loading = false);
	});
</script>

{#if $effect.pending()}
	Loading...
{/if}
```

Notes:
- Added in 5.36.2. `$effect.pending()` returns `true` while any effect in the current boundary is still pending.
- Only meaningful inside components compiled with experimental async support.

---

## getAbortSignal()

```svelte
<script>
	import { getAbortSignal } from 'svelte/reactivity';

	let query = $state('');

	let results = $derived.by(async () => {
		const signal = getAbortSignal();
		const res = await fetch(`/api?q=${query}`, { signal });
		return res.json();
	});
</script>
```

Notes:
- Added in 5.35.0. Returns an `AbortSignal` that is aborted when the reactive context is torn down or recomputed.
- Use inside `$derived.by`, `$effect`, or other reactive contexts to cancel stale async work.

---

## createContext / setContext / getContext

```svelte
<!-- context.ts or .svelte.ts -->
<script module lang="ts">
	import { createContext, getContext, setContext } from 'svelte';

	interface Theme {
		mode: 'light' | 'dark';
		toggle: () => void;
	}

	const key = createContext<Theme>();
	export const getTheme = () => getContext(key);
	export const setTheme = (theme: Theme) => setContext(key, theme);
</script>

<!-- Provider.svelte -->
<script lang="ts">
	let mode = $state<'light' | 'dark'>('light');
	setContext(key, {
		get mode() { return mode; },
		toggle: () => mode = mode === 'light' ? 'dark' : 'light'
	});
</script>

<!-- Child.svelte -->
<script lang="ts">
	const theme = getContext(key);
</script>

<p>Current mode: {theme.mode}</p>
<button onclick={theme.toggle}>Toggle</button>
```

Notes:
- Added in 5.40.0. `createContext<T>()` returns a typed key, replacing the old string/symbol keys.
- 5.50.0: `createContext` can be passed when instantiating components programmatically via `mount`/`hydrate` options.
- Context is still only available to descendants.

---

## svelte/reactivity utilities

```svelte
<script>
	import { SvelteMap, SvelteSet, SvelteDate, SvelteURL, SvelteURLSearchParams } from 'svelte/reactivity';

	let map = new SvelteMap([['a', 1]]);
	let set = new SvelteSet([1, 2, 3]);
	let date = new SvelteDate();
	let url = new SvelteURL('https://example.com?q=1');

	function add() {
		map.set('b', 2);
		set.add(set.size + 1);
		date.setSeconds(date.getSeconds() + 1);
		url.searchParams.set('q', String(+url.searchParams.get('q')! + 1));
	}
</script>

<p>{map.size} / {set.size} / {date.toISOString()} / {url.href}</p>
<button onclick={add}>Add</button>
```

Notes:
- These are reactive drop-in replacements for native classes.
- Mutations (`.set`, `.add`, `.delete`, setters) trigger UI updates without reassignment.
- `SvelteURLSearchParams` is reactive and syncs with the parent `SvelteURL`.

---

## svelte/reactivity/window

```svelte
<script>
	import { innerWidth, innerHeight, scrollY, online } from 'svelte/reactivity/window';
</script>

<p>Viewport: {innerWidth.current} × {innerHeight.current}</p>
<p>Scroll: {scrollY.current}</p>
<p>Online: {online.current}</p>
```

Notes:
- Added in 5.11.0. Reactive wrappers for common `window` properties.
- Access via `.current` (the raw value).
- These are signals, not `$state`, but work reactively in templates.

---

## svelte/motion — Spring / Tween

```svelte
<script>
	import { Spring, Tween } from 'svelte/motion';

	let coords = new Spring({ x: 0, y: 0 }, { stiffness: 0.1, damping: 0.4 });
	let opacity = new Tween(0, { duration: 300 });

	function move(e: MouseEvent) {
		coords.set({ x: e.clientX, y: e.clientY });
		opacity.set(1);
	}
</script>

<div onmousemove={move} style="position: absolute; left: {coords.current.x}px; top: {coords.current.y}px; opacity: {opacity.current}"
>
	Follow
</div>
```

Notes:
- Added in 5.8.0. 5.55.0 exported `TweenOptions`, `SpringOptions`, `SpringUpdateOptions`, and `Updater` types from `svelte/motion`.
- `.current` gives the current animated value; `.set(target)` animates to it.
- `Spring` accepts objects/arrays of numbers; `Tween` interpolates numeric values.
- When to use this vs CSS / `svelte/transition` in Pacto: [design-system/MOTION.md](./design-system/MOTION.md).

---

## createSubscriber / MediaQuery

```svelte
<script>
	import { MediaQuery, prefersReducedMotion } from 'svelte/reactivity';

	const mq = new MediaQuery('(min-width: 768px)');
</script>

{#if mq.current}
	<p>Desktop breakpoint</p>
{:else}
	<p>Mobile breakpoint</p>
{/if}

{#if prefersReducedMotion.current}
	<p>Reduced motion preferred</p>
{/if}
```

Notes:
- Added in 5.7.0.
- `MediaQuery` wraps `matchMedia` reactively; use `.current`.
- `prefersReducedMotion` is a pre-built instance.

---

## Error Boundaries — `<svelte:boundary>`

```svelte
<script>
	let error = $state<Error | null>(null);

	function reset() {
		error = null;
	}
</script>

<svelte:boundary onerror={(e) => error = e} {error}>
	<RiskyComponent />

	{#snippet failed(err, reset)}
		<p>Something broke: {err.message}</p>
		<button onclick={reset}>Retry</button>
	{/snippet}
</svelte:boundary>
```

Notes:
- Added in 5.3.0. 5.53.0 made boundaries work on the server.
- Use `failed` snippet for fallback UI; it receives `(error, resetFn)`.
- `onerror` callback fires when a descendant throws; `reset` snippet argument retries the boundary.
- 5.36.0+ supports async components with `experimental.async` compiler option; boundary `pending` snippet for loading state.

---

## bind:value getter/setter

```svelte
<script>
	let name = $state('Alice');
</script>

<input bind:value={
	() => name,
	(v) => name = v.trimStart()
} />
```

Notes:
- Added in 5.9.0. Use a tuple `[getter, setter]` as the binding target.
- Useful for computed bindings, validation, or transformation.

---

## class attribute as object/array

```svelte
<script>
	let active = $state(true);
	let size = $state('lg');
</script>

<button class={{ active, 'btn-lg': size === 'lg' }}>A</button>
<button class={['btn', active && 'active', `btn-${size}`]}>B</button>
```

Notes:
- Added in 5.16.0. Svelte uses `clsx` internally.
- Object keys are included when truthy; arrays flatten and ignore falsy values.

---

## defaultValue / defaultChecked

```svelte
<script>
	let text = $state('');
	let accept = $state(false);
</script>

<input bind:value={text} defaultValue="hello" />
<input type="checkbox" bind:checked={accept} defaultChecked />
```

Notes:
- Added in 5.6.0. Useful for uncontrolled inputs or resettable forms.
- Unlike `value`, `defaultValue` only sets the initial DOM value and doesn't keep it synced.

---

## Attachments

```svelte
<script>
	import { fromAction } from 'svelte/attachments';

	function tooltip(node: HTMLElement, text: string) {
		const t = document.createElement('div');
		t.textContent = text;
		// ...position and show
		return {
			update(newText: string) { t.textContent = newText; },
			destroy() { t.remove(); }
		};
	}

	const attachTooltip = fromAction(tooltip);

	let tip = $state('I am a tooltip');
</script>

<button use:attachTooltip={tip}>Hover me</button>
```

Notes:
- Added in 5.29.0; `fromAction` helper added in 5.32.0.
- Attachments are the Svelte 5 replacement for actions in many cases; they integrate with snippets/effects.
- Still experimental in spirit; actions (`use:action`) remain available and stable.

---

## Compiler / SSR APIs

```ts
import { compile, compileModule, parse, parseCss, print } from 'svelte/compiler';
import { render } from 'svelte/server';

// Render with CSP nonce / ID prefix / async (experimental)
const { html, head, body } = render(App, {
	props: { message: 'hi' },
	idPrefix: 'app-',      // 5.22.0
	csp: { nonce: 'abc' }, // 5.46.0
});

// Compile options as functions (5.54.0)
compile(source, {
	css: ({ filename }) => filename?.includes('global'),
	runes: ({ filename }) => true,
	customElement: ({ filename }) => filename?.endsWith('.wc.svelte'),
});
```

Notes:
- `parseCss` added in 5.48.0.
- `print` added in 5.45.0 for AST-to-source conversion.
- `csp` option on `render` emits hashes for `hydratable` output.
- 5.54.0: `css`, `runes`, and `customElement` compiler options can be functions receiving the filename.

---

## Writable deriveds

```svelte
<script>
	let count = $state(0);
	let doubled = $derived(count * 2);

	// Writable derived via getter/setter
	let writableDouble = $derived({
		get value() { return count * 2; },
		set value(v) { count = v / 2; }
	});
</script>
```

Notes:
- 5.25.0 made class-field `$derived` writable by adding setters.
- You can also create writable deriveds manually with getter/setter objects.
- Prefer `$state` for local mutable state; writable deriveds are for derived bidirectional bindings.

---

## async components (experimental)

```svelte
<script>
	// With experimental.async compiler option enabled
	let data = await fetchData();
</script>

<p>{data}</p>
```

Notes:
- Added in 5.36.0, stabilized as experimental async SSR in 5.39.0.
- Allows top-level `await` in components and `{@const}` declarations.
- Enable via compiler option `experimental: { async: true }` (or through SvelteKit config).
- Use with `<svelte:boundary>` and `pending` snippets for loading/error UX.

---

## Template declarations (5.56.0)

```svelte
{#each items as item}
	{@let idx = item.id}
	{@const label = item.name.toUpperCase()}
	<li data-id={idx}>{label}</li>
{/each}
```

Notes:
- Added in 5.56.0. Allows `let`/`const` declarations directly in the template via `{@let ...}` and `{@const ...}`.
- Declarations are scoped to their template block and reactively re-evaluated when dependencies change.
- Useful for computed local values inside loops or conditionals without polluting `<script>`.

---

## $inspect (dev-only debugging)

```svelte
<script>
	let count = $state(0);
	let user = $state({ name: 'A' });

	$inspect(count, user);
	$inspect(count).with((type, v) => console.log(type, v));

	$effect(() => {
		$inspect.trace(); // logs which state triggered rerun
	});
</script>
```

Notes:
- `$inspect` is stripped in production.
- `.with()` receives `type` ('init' | 'update') and the value(s).
- `$inspect.trace()` inside `$effect` shows which dependency caused re-execution.

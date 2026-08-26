<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	let {
		active = false,
		unread = false,
		class: className,
		children,
		...restProps
	}: HTMLButtonAttributes & {
		active?: boolean;
		unread?: boolean;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	data-slot="channel-row"
	data-active={active ? 'true' : undefined}
	class={cn(
		'relative flex h-8 w-full appearance-none cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 py-0 text-left font-inherit text-sm font-medium tracking-[0.01em] text-muted-foreground shadow-none outline-none transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none touch-manipulation active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-ring/50',
		unread && 'text-foreground',
		active &&
			'bg-[var(--channel-active-bg)] text-[var(--channel-active-fg)] hover:bg-[var(--channel-active-bg)] hover:text-[var(--channel-active-fg)]',
		!active && 'hover:bg-accent hover:text-foreground',
		className,
	)}
	{...restProps}
>
	{@render children()}
</button>

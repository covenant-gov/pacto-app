<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	type RailTileVariant = 'squad' | 'surface' | 'transparent' | 'add';

	let {
		variant = 'squad',
		active = false,
		dim = false,
		class: className,
		children,
		...restProps
	}: HTMLButtonAttributes & {
		variant?: RailTileVariant;
		active?: boolean;
		dim?: boolean;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	data-slot="rail-tile"
	data-variant={variant}
	data-active={active ? 'true' : undefined}
	data-dim={dim ? 'true' : undefined}
	class={cn(
		'relative flex size-12 shrink-0 appearance-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-inherit shadow-none outline-none transition-[border-radius,background-color,color,opacity,transform] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50',
		'rounded-[15px] hover:rounded-[13px]',
		variant === 'surface' &&
			'rounded-2xl bg-[color-mix(in_hsl,var(--foreground)_12%,transparent)] text-muted-foreground hover:bg-secondary hover:text-foreground data-active:bg-secondary data-active:text-foreground',
		variant === 'transparent' &&
			'rounded-2xl text-muted-foreground hover:bg-secondary hover:text-foreground data-active:bg-secondary data-active:text-foreground',
		variant === 'add' &&
			'rounded-2xl border-2 border-dotted border-border text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
		dim && 'opacity-[0.42] hover:opacity-100',
		active &&
			'after:pointer-events-none after:absolute after:inset-[-4px] after:z-0 after:rounded-[19px] after:border-2 after:border-primary',
		className,
	)}
	{...restProps}
>
	{@render children()}
</button>

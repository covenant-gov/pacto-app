<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { SHELL_WIDE_QUERY } from '$lib/shell';
	import { cn } from '$lib/utils.js';

	let {
		collapsed,
		openLabel,
		closeLabel,
		faces = [],
		class: className,
		onToggle,
	}: {
		collapsed: boolean;
		openLabel: string;
		closeLabel: string;
		faces?: readonly { id?: string; initials: string; color: string }[];
		class?: string;
		onToggle: () => void;
	} = $props();

	const wideShell = new MediaQuery(SHELL_WIDE_QUERY);
	const stack = $derived(faces.slice(0, 3));
</script>

{#if wideShell.current}
	<Button
		variant="ghost"
		size="sm"
		class={cn(
			'h-8 w-auto min-w-8 gap-1 px-1.5 text-[color-mix(in_oklab,var(--foreground)_62%,var(--muted-foreground))] shadow-none',
			'[--avatar-ring:var(--muted)] bg-[var(--avatar-ring)]!',
			'hover:[--avatar-ring:color-mix(in_oklab,var(--foreground)_8%,var(--muted))] hover:text-foreground',
			'aria-expanded:[--avatar-ring:color-mix(in_oklab,var(--foreground)_10%,var(--muted))] aria-expanded:text-foreground',
			'dark:hover:[--avatar-ring:color-mix(in_oklab,var(--foreground)_12%,var(--muted))]',
			'dark:aria-expanded:[--avatar-ring:color-mix(in_oklab,var(--foreground)_14%,var(--muted))]',
			className,
		)}
		aria-label={collapsed ? openLabel : closeLabel}
		aria-expanded={!collapsed}
		onclick={onToggle}
	>
		{#if stack.length}
			<Avatar.Group
				class="-space-x-1.5 *:data-[slot=avatar]:transition-[box-shadow] *:data-[slot=avatar]:duration-150 *:data-[slot=avatar]:ease-[var(--ease-out)] motion-reduce:*:data-[slot=avatar]:transition-none"
				aria-hidden="true"
			>
				{#each stack as face (face.id ?? face.initials + face.color)}
					<Avatar.Root size="sm" class="size-5">
						<Avatar.Fallback class="identity-fill text-[8px] font-semibold" style={`--identity: ${face.color}`}>
							{face.initials}
						</Avatar.Fallback>
					</Avatar.Root>
				{/each}
			</Avatar.Group>
		{/if}
		<ChevronRight
			class={cn(
				'size-3.5 shrink-0 transition-transform duration-200 ease-[var(--ease-out)]',
				collapsed && '-rotate-180',
				'motion-reduce:transition-none',
			)}
			aria-hidden="true"
		/>
	</Button>
{/if}

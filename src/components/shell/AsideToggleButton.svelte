<script lang="ts">
	import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
	import { MediaQuery } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { SHELL_WIDE_QUERY } from '$lib/shell';
	import { cn } from '$lib/utils.js';

	let {
		collapsed,
		openLabel,
		closeLabel,
		class: className,
		onToggle,
	}: {
		collapsed: boolean;
		openLabel: string;
		closeLabel: string;
		class?: string;
		onToggle: () => void;
	} = $props();

	const wideShell = new MediaQuery(SHELL_WIDE_QUERY);
</script>

{#if wideShell.current}
	<Button
		variant="ghost"
		size="icon"
		class={cn(
			'size-8 bg-transparent! text-[color-mix(in_oklab,var(--foreground)_62%,var(--muted-foreground))] shadow-none',
			'hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)]! hover:text-foreground',
			'aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]! aria-expanded:text-foreground',
			'dark:hover:bg-[color-mix(in_oklab,var(--foreground)_12%,transparent)]!',
			'dark:aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]!',
			className,
		)}
		aria-label={collapsed ? openLabel : closeLabel}
		aria-expanded={!collapsed}
		onclick={onToggle}
	>
		{#if collapsed}
			<PanelRightOpen class="size-4" aria-hidden="true" />
		{:else}
			<PanelRightClose class="size-4" aria-hidden="true" />
		{/if}
	</Button>
{/if}

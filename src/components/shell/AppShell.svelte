<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import Users from '@lucide/svelte/icons/users';
	import {
		SHELL_MEDIUM_QUERY,
		SHELL_NARROW_QUERY,
		type AppShellLabels,
		type AppShellRegions,
	} from '$lib/shell';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import ShellDrawer from './ShellDrawer.svelte';

	type ShellViewport = 'narrow' | 'medium' | 'wide';

	function viewportFromWindow(): ShellViewport {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
		if (window.matchMedia(SHELL_NARROW_QUERY).matches) return 'narrow';
		if (window.matchMedia(SHELL_MEDIUM_QUERY).matches) return 'medium';
		return 'wide';
	}

	let {
		rail,
		sidebar,
		main,
		aside,
		labels,
		sidebarOpen = $bindable(false),
		asideOpen = $bindable(false),
		asideCollapsed = $bindable(false),
	}: AppShellRegions & {
		labels: AppShellLabels;
		sidebarOpen?: boolean;
		asideOpen?: boolean;
		asideCollapsed?: boolean;
	} = $props();

	let viewport = $state<ShellViewport>(viewportFromWindow());
	let sidebarTrigger: HTMLButtonElement | null = $state(null);
	let asideTrigger: HTMLButtonElement | null = $state(null);

	const sidebarInGrid = $derived(viewport !== 'narrow');
	const asideInGrid = $derived(Boolean(aside) && viewport === 'wide' && !asideCollapsed);
	const showSidebarDrawer = $derived(viewport === 'narrow');
	const showAsideDrawer = $derived(Boolean(aside) && viewport !== 'wide');
	const showDrawerBar = $derived(showSidebarDrawer || showAsideDrawer);
	const contentInert = $derived(sidebarOpen || asideOpen);

	$effect.pre(() => {
		if (typeof window.matchMedia !== 'function') return;

		const narrowMq = window.matchMedia(SHELL_NARROW_QUERY);
		const mediumMq = window.matchMedia(SHELL_MEDIUM_QUERY);

		function viewportFromQueries(): ShellViewport {
			if (narrowMq.matches) return 'narrow';
			if (mediumMq.matches) return 'medium';
			return 'wide';
		}

		viewport = viewportFromQueries();

		function onViewportChange(): void {
			const next = viewportFromQueries();
			viewport = next;
			if (next !== 'narrow') sidebarOpen = false;
			if (next === 'wide') asideOpen = false;
		}

		narrowMq.addEventListener('change', onViewportChange);
		mediumMq.addEventListener('change', onViewportChange);

		return () => {
			narrowMq.removeEventListener('change', onViewportChange);
			mediumMq.removeEventListener('change', onViewportChange);
		};
	});
</script>

<div
	class={cn(
		'grid h-full min-h-0 w-full overflow-hidden bg-background text-foreground',
		viewport === 'narrow'
			? "grid-cols-[64px_minmax(0,1fr)] [grid-template-areas:'rail_main']"
			: asideInGrid
				? "grid-cols-[72px_244px_minmax(0,1fr)_220px] [grid-template-areas:'rail_sidebar_main_aside']"
				: "grid-cols-[72px_244px_minmax(0,1fr)] [grid-template-areas:'rail_sidebar_main']",
	)}
	data-shell-background
	data-viewport={viewport}
>
	<div
		class="min-h-0 bg-shell-rail [grid-area:rail]"
		data-shell-region="rail"
		inert={contentInert || undefined}
		aria-hidden={contentInert || undefined}
	>
		{@render rail()}
	</div>

	{#if sidebarInGrid}
		<div
			class="min-h-0 [grid-area:sidebar]"
			data-shell-region="sidebar"
			inert={contentInert || undefined}
			aria-hidden={contentInert || undefined}
		>
			{@render sidebar()}
		</div>
	{/if}

	<main
		class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted [grid-area:main]"
		aria-label={labels.main}
		data-shell-region="main"
	>
		{#if showDrawerBar}
			<div
				class={cn(
					'flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border bg-muted px-2',
					viewport === 'narrow' && 'justify-between',
				)}
			>
				{#if showSidebarDrawer}
					<Button
						bind:ref={sidebarTrigger}
						variant="ghost"
						size="icon"
						aria-label={labels.openSidebar}
						aria-haspopup="dialog"
						aria-expanded={sidebarOpen}
						onclick={() => (sidebarOpen = true)}
					>
						<Menu class="size-4" aria-hidden="true" />
					</Button>
				{/if}
				{#if showAsideDrawer}
					<Button
						bind:ref={asideTrigger}
						variant="ghost"
						size="icon"
						aria-label={labels.openAside}
						aria-haspopup="dialog"
						aria-expanded={asideOpen}
						onclick={() => (asideOpen = true)}
					>
						<Users class="size-4" aria-hidden="true" />
					</Button>
				{/if}
			</div>
		{/if}
		<div
			class="min-h-0 min-w-0 flex-1 overflow-hidden"
			inert={contentInert || undefined}
			aria-hidden={contentInert || undefined}
		>
			{@render main()}
		</div>
	</main>

	{#if aside && asideInGrid}
		<div
			class="min-h-0 border-l border-border [grid-area:aside]"
			data-shell-region="aside"
			inert={contentInert || undefined}
			aria-hidden={contentInert || undefined}
		>
			{@render aside()}
		</div>
	{/if}
</div>

{#if showSidebarDrawer}
	<ShellDrawer
		bind:open={sidebarOpen}
		side="left"
		label={labels.sidebarDrawer}
		closeLabel={labels.closeSidebar}
		returnFocusTo={sidebarTrigger}
	>
		{#if sidebarOpen}
			{@render sidebar()}
		{/if}
	</ShellDrawer>
{/if}

{#if aside && showAsideDrawer}
	<ShellDrawer
		bind:open={asideOpen}
		side="right"
		label={labels.asideDrawer}
		closeLabel={labels.closeAside}
		returnFocusTo={asideTrigger}
	>
		{#if asideOpen}
			{@render aside()}
		{/if}
	</ShellDrawer>
{/if}

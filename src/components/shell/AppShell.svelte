<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import Users from '@lucide/svelte/icons/users';
	import type { AppShellLabels, AppShellRegions } from '$lib/shell';
	import ShellDrawer from './ShellDrawer.svelte';

	type ShellViewport = 'narrow' | 'medium' | 'wide';

	const NARROW_QUERY = '(max-width: 720px)';
	const MEDIUM_QUERY = '(max-width: 1180px)';

	function viewportFromWindow(): ShellViewport {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
		if (window.matchMedia(NARROW_QUERY).matches) return 'narrow';
		if (window.matchMedia(MEDIUM_QUERY).matches) return 'medium';
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
	}: AppShellRegions & {
		labels: AppShellLabels;
		sidebarOpen?: boolean;
		asideOpen?: boolean;
	} = $props();

	let viewport = $state<ShellViewport>(viewportFromWindow());
	let sidebarTrigger: HTMLButtonElement | null = $state(null);
	let asideTrigger: HTMLButtonElement | null = $state(null);

	const sidebarInGrid = $derived(viewport !== 'narrow');
	const asideInGrid = $derived(Boolean(aside) && viewport === 'wide');
	const showSidebarDrawer = $derived(viewport === 'narrow');
	const showAsideDrawer = $derived(Boolean(aside) && viewport !== 'wide');
	const showDrawerBar = $derived(showSidebarDrawer || showAsideDrawer);
	const contentInert = $derived(sidebarOpen || asideOpen);

	$effect.pre(() => {
		if (typeof window.matchMedia !== 'function') return;

		const narrowMq = window.matchMedia(NARROW_QUERY);
		const mediumMq = window.matchMedia(MEDIUM_QUERY);

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
	class:has-aside={aside}
	class="shell-grid h-full min-h-0 w-full overflow-hidden"
	data-shell-background
	data-viewport={viewport}
>
	<div
		class="shell-rail min-h-0"
		data-shell-region="rail"
		inert={contentInert || undefined}
		aria-hidden={contentInert || undefined}
	>
		{@render rail()}
	</div>

	{#if sidebarInGrid}
		<div
			class="shell-sidebar min-h-0"
			data-shell-region="sidebar"
			inert={contentInert || undefined}
			aria-hidden={contentInert || undefined}
		>
			{@render sidebar()}
		</div>
	{/if}

	<main class="shell-main min-h-0 min-w-0" aria-label={labels.main} data-shell-region="main">
		{#if showDrawerBar}
			<div class="shell-drawer-bar">
				{#if showSidebarDrawer}
					<button
						bind:this={sidebarTrigger}
						type="button"
						class="shell-drawer-trigger"
						aria-label={labels.openSidebar}
						aria-haspopup="dialog"
						aria-expanded={sidebarOpen}
						onclick={() => (sidebarOpen = true)}
					>
						<Menu class="size-4" aria-hidden="true" />
					</button>
				{/if}
				{#if showAsideDrawer}
					<button
						bind:this={asideTrigger}
						type="button"
						class="shell-drawer-trigger"
						aria-label={labels.openAside}
						aria-haspopup="dialog"
						aria-expanded={asideOpen}
						onclick={() => (asideOpen = true)}
					>
						<Users class="size-4" aria-hidden="true" />
					</button>
				{/if}
			</div>
		{/if}
		<div
			class="shell-main-content min-h-0 min-w-0"
			inert={contentInert || undefined}
			aria-hidden={contentInert || undefined}
		>
			{@render main()}
		</div>
	</main>

	{#if aside && asideInGrid}
		<div
			class="shell-aside min-h-0"
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

<style>
	.shell-grid {
		display: grid;
		grid-template-columns: 72px 244px minmax(0, 1fr);
		grid-template-areas: 'rail sidebar main';
		background: var(--bg-page);
		color: var(--text-primary);
	}

	.shell-grid.has-aside[data-viewport='wide'] {
		grid-template-columns: 72px 244px minmax(0, 1fr) 220px;
		grid-template-areas: 'rail sidebar main aside';
	}

	.shell-grid[data-viewport='narrow'],
	.shell-grid.has-aside[data-viewport='narrow'] {
		grid-template-columns: 64px minmax(0, 1fr);
		grid-template-areas: 'rail main';
	}

	.shell-rail {
		--shell-rail-bg: #060c17;
		grid-area: rail;
		background: var(--shell-rail-bg);
	}

	.shell-sidebar {
		grid-area: sidebar;
	}

	.shell-main {
		grid-area: main;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-page);
	}

	.shell-main-content {
		flex: 1;
		overflow: hidden;
	}

	.shell-aside {
		grid-area: aside;
		border-left: 1px solid var(--border-subtle);
	}

	.shell-drawer-bar {
		display: flex;
		height: 40px;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		border-bottom: 1px solid var(--border-subtle);
		padding: 4px 8px;
		background: var(--bg-panel);
	}

	.shell-grid[data-viewport='narrow'] .shell-drawer-bar {
		justify-content: space-between;
	}

	.shell-drawer-trigger {
		appearance: none;
		display: inline-flex;
		width: 32px;
		height: 32px;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 6px;
		background: transparent;
		box-shadow: none;
		color: var(--text-secondary);
		touch-action: manipulation;
	}

	.shell-drawer-trigger:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.shell-drawer-trigger:hover {
			background: var(--bg-hover);
			color: var(--text-primary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shell-drawer-trigger {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { modes, type DashboardMode } from '../fixtures.js';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import Hash from '@lucide/svelte/icons/hash';
	import { t } from 'svelte-i18n';
	import { design } from '../design-state.svelte.js';

	let { children }: { children: Snippet } = $props();

	const activeMode = $derived(
		(modes.find((mode) => page.url.pathname.endsWith(`/dashboard/${mode.id}`))?.id ??
			'status') as DashboardMode,
	);

	function dashboardRoute(mode: DashboardMode):
		| '/design/dashboard/status'
		| '/design/dashboard/governance'
		| '/design/dashboard/treasury'
		| '/design/dashboard/roles' {
		switch (mode) {
			case 'status':
				return '/design/dashboard/status';
			case 'governance':
				return '/design/dashboard/governance';
			case 'treasury':
				return '/design/dashboard/treasury';
			case 'roles':
				return '/design/dashboard/roles';
			default: {
				const exhaustiveMode: never = mode;
				return exhaustiveMode;
			}
		}
	}

</script>

<div class="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-page)]">
	<div
		class="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 shadow-[0_1px_0_rgba(0,0,0,0.25)]"
	>
		<Hash class="size-[18px] shrink-0 text-[var(--text-muted)]" />
		<span class="text-[15px] font-semibold tracking-[0.01em] text-balance text-[var(--text-primary)]"
			>{design.activeChannel?.name ?? $t('design.dashboard.channelName')}</span
		>
	</div>

	<div class="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3">
		<nav class="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label={$t('design.dashboard.nav')}>
			{#each modes as mode (mode.id)}
				<a
					href={resolve(
						`${dashboardRoute(mode.id)}${page.url.search}` as ReturnType<typeof dashboardRoute>,
					)}
					aria-current={activeMode === mode.id ? 'page' : undefined}
					class={cn('dashboard-tab', activeMode === mode.id && 'dashboard-tab--active')}
				>
					{$t(`design.dashboard.tab.${mode.id}`)}
				</a>
			{/each}
		</nav>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{@render children()}
	</div>
</div>

<style>
	.dashboard-tab {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 12px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 140ms var(--ease-out);
	}

	.dashboard-tab:active {
		transform: scale(0.96);
	}

	.dashboard-tab--active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.dashboard-tab:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.dashboard-tab:not(.dashboard-tab--active):hover {
			background: rgba(255, 255, 255, 0.04);
			color: var(--text-secondary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dashboard-tab {
			transition: none;
		}
	}
</style>

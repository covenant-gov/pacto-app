<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { modes, type DashboardMode } from '../fixtures.js';
	import type { Snippet } from 'svelte';
	import Hash from '@lucide/svelte/icons/hash';
	import { t } from 'svelte-i18n';
	import { design } from '../design-state.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import AsideToggleButton from '../../../components/shell/AsideToggleButton.svelte';

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

<div class="flex h-full min-w-0 flex-1 flex-col bg-muted">
	<div class="flex h-12 shrink-0 items-center gap-2 bg-muted px-4">
		<Hash class="size-[18px] shrink-0 text-muted-foreground" />
		<span class="text-[15px] font-semibold tracking-[0.01em] text-balance text-foreground">
			{design.activeChannel?.name ?? $t('design.dashboard.channelName')}
		</span>
		<AsideToggleButton
			class="ml-auto"
			collapsed={design.asideCollapsed}
			openLabel={$t('design.shell.openMembers')}
			closeLabel={$t('design.shell.closeMembers')}
			onToggle={() => (design.asideCollapsed = !design.asideCollapsed)}
		/>
	</div>

	<div class="flex h-10 shrink-0 items-center gap-1 bg-muted px-3">
		<nav class="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label={$t('design.dashboard.nav')}>
			{#each modes as mode (mode.id)}
				<Button
					href={resolve(`${dashboardRoute(mode.id)}${page.url.search}` as ReturnType<typeof dashboardRoute>)}
					variant="tab"
					size="sm"
					aria-current={activeMode === mode.id ? 'page' : undefined}
				>
					{$t(`design.dashboard.tab.${mode.id}`)}
				</Button>
			{/each}
		</nav>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto rounded-tl-lg bg-background">
		{@render children()}
	</div>
</div>

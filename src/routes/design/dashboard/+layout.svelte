<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { parseShellPreviewState } from '$lib/shell';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';
	import Hash from '@lucide/svelte/icons/hash';
	import { t } from 'svelte-i18n';
	import { AsideToggleButton } from '../../../components/shell';
	import { design } from '../design-state.svelte.js';
	import { memberToggleFaces, members, modes, type DashboardMode } from '../fixtures.js';

	let { children }: { children: Snippet } = $props();

	const activeMode = $derived(
		(modes.find((mode) => page.url.pathname.endsWith(`/dashboard/${mode.id}`))?.id ??
			'status') as DashboardMode,
	);
	const previewState = $derived(parseShellPreviewState(page.url.searchParams.get('state')));
	const memberFaces = $derived(memberToggleFaces(members, previewState));

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
			faces={memberFaces}
			openLabel={$t('design.shell.openMembers')}
			closeLabel={$t('design.shell.closeMembers')}
			onToggle={() => (design.asideCollapsed = !design.asideCollapsed)}
		/>
	</div>

	<div class="flex h-11 shrink-0 items-center bg-muted px-3">
		<nav
			class="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary p-0.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--border)_50%,var(--background))]"
			aria-label={$t('design.dashboard.nav')}
		>
			{#each modes as mode (mode.id)}
				<Button
					href={resolve(`${dashboardRoute(mode.id)}${page.url.search}` as ReturnType<typeof dashboardRoute>)}
					variant="tab"
					size="sm"
					class="h-8 px-3"
					aria-current={activeMode === mode.id ? 'page' : undefined}
				>
					{$t(`design.dashboard.tab.${mode.id}`)}
				</Button>
			{/each}
		</nav>
	</div>

	<div class="shell-dither-seam min-h-0 flex-1 overflow-y-auto rounded-tl-lg bg-background">
		{@render children()}
	</div>
</div>

<script lang="ts">
	import { addMessages, t } from 'svelte-i18n';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import AppShell from '../../components/shell/AppShell.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { parseShellPreviewState, type AppShellLabels, type ShellPreviewState } from '$lib/shell';
	import { setTheme, theme, type Theme } from '../../stores/theme';
	import DesignToolbar from './DesignToolbar.svelte';
	import DesignRail from './components/DesignRail.svelte';
	import DesignChannels from './components/DesignChannels.svelte';
	import DesignMembers from './components/DesignMembers.svelte';
	import { design } from './design-state.svelte.js';
	import { currentUser, members, overlayChannels, overlayMembers } from './fixtures';
	import type { DashboardMode } from './fixtures';
	import en from './locales/en.json';
	import es from './locales/es.json';

	let { children }: { children: Snippet } = $props();

	addMessages('en', en);
	addMessages('es', es);

	const previewState = $derived(parseShellPreviewState(page.url.searchParams.get('state')));
	const onDashboard = $derived(page.url.pathname.startsWith('/design/dashboard'));
	const visibleChannels = $derived(overlayChannels(design.channelList, previewState));
	const visibleMembers = $derived(overlayMembers(members, previewState));

	const appShellLabels = $derived<AppShellLabels>({
		main: $t('design.shell.main'),
		openSidebar: $t('design.shell.openChannels'),
		openAside: $t('design.shell.openMembers'),
		closeSidebar: $t('design.shell.closeChannels'),
		closeAside: $t('design.shell.closeMembers'),
		sidebarDrawer: $t('design.shell.channelsDrawer'),
		asideDrawer: $t('design.shell.membersDrawer'),
	});

	$effect(() => {
		if (onDashboard) design.activeChannelId = 'dashboard';
	});

	function dashboardModeFromPath(pathname: string): DashboardMode {
		if (pathname.endsWith('/governance')) return 'governance';
		if (pathname.endsWith('/treasury')) return 'treasury';
		if (pathname.endsWith('/roles')) return 'roles';
		return 'status';
	}

	function selectPreviewState(state: ShellPreviewState): void {
		const url = new URL(page.url);
		url.searchParams.set('state', state);
		const query = url.searchParams.toString();
		if (onDashboard) {
			const mode = dashboardModeFromPath(page.url.pathname);
			const destination = `/design/dashboard/${mode}?${query}` as `/design/dashboard/${DashboardMode}?${string}`;
			replaceState(resolve(destination), page.state);
			return;
		}
		const destination: `/design?${string}` = `/design?${query}`;
		replaceState(resolve(destination), page.state);
	}

	function selectChannel(id: string): void {
		const search = page.url.search;
		if (id === 'dashboard') {
			design.activeChannelId = id;
			void goto(resolve(`/design/dashboard/status${search}` as '/design/dashboard/status'));
			return;
		}
		design.consumeChannel(id);
		if (onDashboard) {
			void goto(resolve(`/design${search}` as '/design'));
		}
	}
</script>

<svelte:head>
	<title>{$t('design.pageTitle')}</title>
</svelte:head>

<div class="design-page h-full min-h-0">
	<DesignToolbar
		theme={$theme}
		{previewState}
		onThemeChange={(value: Theme) => setTheme(value)}
		onPreviewStateChange={selectPreviewState}
	/>

	<div class="shell-host min-h-0">
		<AppShell labels={appShellLabels}>
			{#snippet rail()}
				<DesignRail
					squads={design.squadList}
					activeSquadId={design.activeSquadId}
					dmCount={3}
					activityCount={7}
					onSelectSquad={(id) => design.selectSquad(id)}
					onMarkSquadRead={(id) => design.markSquadRead(id)}
					onLeaveSquad={(id) => design.leaveSquad(id)}
					squadHasNotifications={(id) => design.squadHasNotifications(id)}
					onAddSquad={() => design.openAddSquad()}
					onSelectLens={(lens) => design.selectLens(lens)}
					activeLens={design.activeLens}
				/>
			{/snippet}

			{#snippet sidebar()}
				{#if design.activeSquad}
					<DesignChannels
						squadName={design.activeSquad.name}
						channels={visibleChannels}
						activeChannelId={onDashboard ? 'dashboard' : design.activeChannelId}
						dashboardActive={onDashboard}
						{currentUser}
						presence={design.presence}
						onSelectChannel={selectChannel}
						onAddChannel={() => design.openAddChannel()}
						onPresenceChange={(status) => design.changePresence(status)}
						onLeaveSquad={() => design.leaveSquad(design.activeSquadId)}
					/>
				{/if}
			{/snippet}

			{#snippet main()}
				{@render children()}
			{/snippet}

			{#snippet aside()}
				<DesignMembers members={visibleMembers} />
			{/snippet}
		</AppShell>
	</div>
</div>

<Dialog.Root bind:open={design.addSquadOpen}>
	<Dialog.Content>
		<form onsubmit={(event) => design.confirmAddSquad(event)}>
			<Dialog.Header>
				<Dialog.Title>{$t('design.dialog.addSquadTitle')}</Dialog.Title>
				<Dialog.Description>{$t('design.dialog.addSquadDescription')}</Dialog.Description>
			</Dialog.Header>
			<input
				type="text"
				bind:value={design.newSquadName}
				placeholder={$t('design.dialog.squadNamePlaceholder')}
				aria-label={$t('design.dialog.squadName')}
				autocomplete="off"
				spellcheck="false"
				class="dialog-input mt-2"
			/>
			<Dialog.Footer class="mt-4">
				<Button type="button" variant="outline" onclick={() => (design.addSquadOpen = false)}>
					{$t('design.dialog.cancel')}
				</Button>
				<Button type="submit" disabled={!design.newSquadName.trim()}>
					{$t('design.dialog.create')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={design.addChannelOpen}>
	<Dialog.Content>
		<form onsubmit={(event) => design.confirmAddChannel(event)}>
			<Dialog.Header>
				<Dialog.Title>{$t('design.dialog.addChannelTitle')}</Dialog.Title>
				<Dialog.Description>{$t('design.dialog.addChannelDescription')}</Dialog.Description>
			</Dialog.Header>
			<input
				type="text"
				bind:value={design.newChannelName}
				placeholder={$t('design.dialog.channelNamePlaceholder')}
				aria-label={$t('design.dialog.channelName')}
				autocomplete="off"
				spellcheck="false"
				class="dialog-input mt-2"
			/>
			<Dialog.Footer class="mt-4">
				<Button type="button" variant="outline" onclick={() => (design.addChannelOpen = false)}>
					{$t('design.dialog.cancel')}
				</Button>
				<Button type="submit" disabled={!design.newChannelName.trim()}>
					{$t('design.dialog.create')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<style>
	.design-page {
		display: flex;
		flex: 1;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-page);
	}

	.shell-host {
		flex: 1;
		overflow: hidden;
	}

	.dialog-input {
		width: 100%;
		height: 36px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-panel);
		color: var(--text-primary);
		font-family: var(--font-ui);
		font-size: 0.875rem;
		padding: 0 10px;
	}

	.dialog-input:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}
</style>

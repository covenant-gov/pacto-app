<script lang="ts">
	import { addMessages, t } from 'svelte-i18n';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import AppShell from '../../components/shell/AppShell.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { parseShellPreviewState, type AppShellLabels, type ShellPreviewState } from '$lib/shell';
	import { onMount } from 'svelte';
	import { DEFAULT_THEME, getStoredTheme, setTheme } from '../../stores/theme';
	import DesignToolbar from './DesignToolbar.svelte';
	import DesignRail from './components/DesignRail.svelte';
	import DesignChannels from './components/DesignChannels.svelte';
	import DesignMembers from './components/DesignMembers.svelte';
	import DesignGate from './components/DesignGate.svelte';
	import { design } from './design-state.svelte.js';
	import { currentUser, members, overlayChannels, overlayMembers } from './fixtures';
	import type { DashboardMode } from './fixtures';
	import en from './locales/en.json';
	import es from './locales/es.json';
	import './dither.css';
	import './sketches/techno-light-paper.css';
	import './sketches/techno-light-signal.css';
	import {
		applyPlaygroundTheme,
		isDesignTheme,
		readDesignPreviewTheme,
		writeDesignPreviewTheme,
		type DesignTheme,
	} from './sketches/sketches';

	let { children }: { children: Snippet } = $props();

	let previewTheme = $state<DesignTheme>(DEFAULT_THEME);

	onMount(() => {
		const preview = readDesignPreviewTheme() ?? DEFAULT_THEME;
		previewTheme = preview;
		applyPlaygroundTheme(preview);
		return () => {
			setTheme(getStoredTheme() ?? DEFAULT_THEME);
		};
	});

	function selectTheme(value: DesignTheme): void {
		previewTheme = value;
		writeDesignPreviewTheme(value);
		applyPlaygroundTheme(value);
	}

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

<div
	class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
	data-dither-pattern={design.ditherPattern}
	style={`--dither-mix: ${design.ditherMix}; --dither-tile: ${design.ditherTile}px; --dither-edge: ${design.ditherEdge}px;`}
>
	<DesignToolbar
		theme={previewTheme}
		{previewState}
		onThemeChange={(value: DesignTheme) => {
			if (!isDesignTheme(value)) return;
			selectTheme(value);
		}}
		onPreviewStateChange={selectPreviewState}
	/>

	<div class="relative min-h-0 flex-1 overflow-hidden">
		<AppShell labels={appShellLabels} bind:asideCollapsed={design.asideCollapsed}>
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
		{#if design.gateOpen}
			<DesignGate onClose={() => (design.gateOpen = false)} />
		{/if}
	</div>
</div>

<Dialog.Root bind:open={design.addSquadOpen}>
	<Dialog.Content>
		<form onsubmit={(event) => design.confirmAddSquad(event)}>
			<Dialog.Header>
				<Dialog.Title>{$t('design.dialog.addSquadTitle')}</Dialog.Title>
				<Dialog.Description>{$t('design.dialog.addSquadDescription')}</Dialog.Description>
			</Dialog.Header>
			<Label class="sr-only" for="design-squad-name">{$t('design.dialog.squadName')}</Label>
			<Input
				id="design-squad-name"
				type="text"
				bind:value={design.newSquadName}
				placeholder={$t('design.dialog.squadNamePlaceholder')}
				aria-label={$t('design.dialog.squadName')}
				autocomplete="off"
				spellcheck="false"
				class="mt-2"
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
			<Label class="sr-only" for="design-channel-name">{$t('design.dialog.channelName')}</Label>
			<Input
				id="design-channel-name"
				type="text"
				bind:value={design.newChannelName}
				placeholder={$t('design.dialog.channelNamePlaceholder')}
				aria-label={$t('design.dialog.channelName')}
				autocomplete="off"
				spellcheck="false"
				class="mt-2"
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

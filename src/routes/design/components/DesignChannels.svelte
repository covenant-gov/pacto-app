<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Hash from '@lucide/svelte/icons/hash';
	import Search from '@lucide/svelte/icons/search';
	import Lock from '@lucide/svelte/icons/lock';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pin from '@lucide/svelte/icons/pin';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import { t } from 'svelte-i18n';
	import { presenceStatuses, type Channel, type CurrentUser, type PresenceStatus } from '../fixtures.js';

	let {
		squadName,
		channels,
		activeChannelId,
		dashboardActive = false,
		currentUser,
		presence,
		onSelectChannel,
		onAddChannel,
		onPresenceChange,
		onLeaveSquad,
		onOpenSettings,
	}: {
		squadName: string;
		channels: Channel[];
		activeChannelId: string;
		dashboardActive?: boolean;
		currentUser: CurrentUser;
		presence: PresenceStatus;
		onSelectChannel: (id: string) => void;
		onAddChannel: () => void;
		onPresenceChange: (status: PresenceStatus) => void;
		onLeaveSquad?: () => void;
		onOpenSettings?: () => void;
	} = $props();

	let searchTerm = $state('');

	const filteredChannels = $derived(
		channels.filter((channel) => channel.name.toLocaleLowerCase().includes(searchTerm.trim().toLocaleLowerCase())),
	);
	const squadChannels = $derived(filteredChannels.filter((channel) => channel.category === 'squad'));
	const otherChannels = $derived(filteredChannels.filter((channel) => channel.category === 'channels'));

	const presenceDotClass: Record<PresenceStatus, string> = {
		online: 'bg-[var(--success)]',
		away: 'bg-[var(--warning)]',
		dnd: 'bg-[var(--danger)]',
		offline: 'bg-[var(--text-muted)]',
		invisible: 'bg-[var(--text-muted)]',
	};

	const presenceLabel = $derived($t(`design.presence.${presence}`));

	function isChannelActive(channel: Channel) {
		if (channel.id === 'dashboard') return dashboardActive;
		return !dashboardActive && channel.id === activeChannelId;
	}

	function channelAriaLabel(channel: Channel): string {
		const parts = [$t('design.channels.select', { values: { name: channel.name } })];
		if (channel.mentionCount) {
			parts.push($t('design.channels.mentions', { values: { count: channel.mentionCount } }));
		} else if (channel.unread) {
			parts.push($t('design.channels.unread'));
		}
		return parts.join(', ');
	}
</script>

{#snippet channelRow(channel: Channel)}
	<button
		type="button"
		onclick={() => onSelectChannel(channel.id)}
		aria-current={isChannelActive(channel) ? 'true' : undefined}
		aria-label={channelAriaLabel(channel)}
		class={cn('channel-row', channel.unread && 'channel-row--unread', isChannelActive(channel) && 'channel-row--active')}
	>
		{#if channel.id === 'announcements'}
			<Megaphone class="size-[15px] shrink-0 opacity-65" aria-hidden="true" />
		{:else if channel.category === 'squad'}
			<Pin class="size-[15px] shrink-0 opacity-65" aria-hidden="true" />
		{:else}
			<Hash class="size-[15px] shrink-0 opacity-65" aria-hidden="true" />
		{/if}
		<span class="flex-1 truncate text-left">{channel.name}</span>
		{#if channel.locked}
			<Lock class="size-3 shrink-0 opacity-60" aria-hidden="true" />
		{/if}
		<span class="channel-status-slot" aria-hidden="true">
			{#if channel.mentionCount}
				<span class="mention-badge">{channel.mentionCount}</span>
			{:else if channel.unread}
				<span class="channel-unread-mark">✷</span>
			{/if}
		</span>
	</button>
{/snippet}

<nav class="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-panel)]" aria-label={$t('design.channels.navigation')}>
	<div class="side-head flex h-12 shrink-0 items-center gap-2 px-4">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="squad-menu-trigger flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-medium tracking-[0.01em] text-[var(--text-primary)]"
					>
						<span class="truncate">{squadName}</span>
						<ChevronDown class="size-3.5 shrink-0 text-[var(--text-muted)]" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				<DropdownMenu.Item>{$t('design.channels.squadSettings')}</DropdownMenu.Item>
				<DropdownMenu.Item>{$t('design.channels.inviteMembers')}</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					variant="destructive"
					onclick={() => onLeaveSquad?.()}
				>
					{$t('design.channels.leaveSquad')}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{#if onOpenSettings}
			<Button variant="ghost" size="icon-sm" aria-label={$t('design.channels.squadSettings')} onclick={onOpenSettings}>
				<Settings class="size-4" />
			</Button>
		{/if}
	</div>

	<div class="px-2 pt-2">
		<div class="relative">
			<Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
			<input
				type="search"
				bind:value={searchTerm}
				placeholder={$t('design.channels.searchPlaceholder')}
				aria-label={$t('design.channels.search')}
				class="channel-search"
			/>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-2 pb-2">
		{#if filteredChannels.length === 0}
			<p class="channel-empty">{$t('design.channels.empty')}</p>
		{:else}
			{#if squadChannels.length > 0}
				<div class="channel-category">{$t('design.channels.categorySquad')}</div>
				{#each squadChannels as channel (channel.id)}
					{@render channelRow(channel)}
				{/each}
			{/if}

			{#if otherChannels.length > 0}
				<div class="channel-category">{$t('design.channels.categoryChannels')}</div>
				{#each otherChannels as channel (channel.id)}
					{@render channelRow(channel)}
				{/each}
			{/if}
		{/if}

		<button type="button" onclick={onAddChannel} class="channel-add">
			<Plus class="size-3.5" />
			<span>{$t('design.channels.addChannel')}</span>
		</button>
	</div>

	<div class="user-strip flex h-[52px] shrink-0 items-center gap-2 px-2">
		<div class="relative size-8 shrink-0">
			<div
				class="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-[var(--text-primary)]"
				style={`background-color: ${currentUser.color};`}
			>
				{currentUser.initials}
			</div>
			<span
				class={cn(
					'user-presence absolute -right-px -bottom-px size-2.5 rounded-full border-2',
					presenceDotClass[presence],
				)}
			></span>
		</div>
		<div class="user-meta min-w-0 flex-1">
			<span class="user-meta__name truncate">{currentUser.name}</span>
			<span class="user-meta__status truncate">{presenceLabel}</span>
		</div>
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-sm" aria-label={$t('design.channels.presenceSettings')}>
						<Settings class="size-4" />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content align="end" class="w-52 p-1">
				{#each presenceStatuses as status (status)}
					<button
						type="button"
						onclick={() => onPresenceChange(status)}
						class={cn(
							'presence-option flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)]',
							status === presence ? 'presence-option--active' : 'hover:bg-[var(--bg-hover)]',
						)}
					>
						<span class={cn('size-2.5 rounded-full', presenceDotClass[status])}></span>
						{$t(`design.presence.${status}`)}
					</button>
				{/each}
			</Popover.Content>
		</Popover.Root>
	</div>
</nav>

<style>
	.side-head {
		border-bottom: 1px solid var(--border-subtle);
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
	}

	.channel-search {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 28px;
		padding: 0 8px 0 26px;
		border: 0;
		border-radius: 5px;
		background-color: var(--bg-page);
		background-image: none;
		box-shadow: none;
		color: var(--text-primary);
		font-family: var(--font-ui);
		font-size: 0.75rem;
	}

	.channel-search:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	.channel-empty {
		padding: 12px 8px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.mention-badge {
		display: inline-flex;
		height: 18px;
		min-width: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		padding: 0 4px;
		background: var(--notif);
		color: #fff;
		font-size: 10px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.user-strip {
		--user-strip-bg: #0c1524;
		background: var(--user-strip-bg);
	}

	.user-presence {
		border-color: var(--user-strip-bg);
	}

	.user-meta {
		display: flex;
		height: 32px;
		flex-direction: column;
		justify-content: space-between;
		padding-block: 1px;
	}

	.user-meta__name {
		font-size: 13px;
		font-weight: 600;
		line-height: 1;
		color: var(--text-primary);
	}

	.user-meta__status {
		font-size: 11px;
		line-height: 1;
		color: var(--text-muted);
	}

	.channel-category {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 20px 8px 4px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.squad-menu-trigger,
	.presence-option,
	.channel-row {
		-webkit-appearance: none;
		appearance: none;
		border: 0;
		outline: none;
		background-color: transparent;
		background-image: none;
		box-shadow: none;
		font: inherit;
	}

	.channel-row {
		position: relative;
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 8px;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--text-muted);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			transform 140ms var(--ease-out),
			background-color 120ms ease,
			color 120ms ease;
	}

	.channel-row:active {
		transform: scale(0.985);
	}

	.channel-row:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	.squad-menu-trigger:focus-visible,
	.presence-option:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	.presence-option--active {
		background: var(--bg-hover);
	}

	.channel-row--unread {
		color: var(--text-primary);
		font-weight: 500;
	}

	.channel-status-slot {
		display: flex;
		width: 26px;
		height: 18px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
	}

	.channel-unread-mark {
		color: var(--text-primary);
		font-size: 12px;
		line-height: 1;
	}

	.channel-row--active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.channel-add {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 32px;
		margin-top: 4px;
		padding: 0 10px;
		-webkit-appearance: none;
		appearance: none;
		border: 2px dotted var(--border-subtle);
		border-radius: 5px;
		background-color: transparent;
		background-image: none;
		box-shadow: none;
		font-size: 13.5px;
		color: var(--text-muted);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			transform 140ms var(--ease-out),
			background-color 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}

	.channel-add:active {
		transform: scale(0.98);
	}

	.channel-add:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.channel-row:not(.channel-row--active):hover {
			background: rgba(255, 255, 255, 0.04);
			color: var(--text-secondary);
		}
		.channel-add:hover {
			border-color: var(--border);
			color: var(--text-secondary);
			background: rgba(255, 255, 255, 0.04);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.channel-row,
		.channel-add {
			transition: none;
		}
	}
</style>

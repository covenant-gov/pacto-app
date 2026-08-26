<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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
	import { ChannelRow, PresenceAvatar } from '../../../components/shell';

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
		online: 'bg-gov-success',
		away: 'bg-warning',
		dnd: 'bg-destructive',
		offline: 'bg-muted-foreground',
		invisible: 'bg-muted-foreground',
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

	function toPresence(status: PresenceStatus) {
		if (status === 'dnd') return 'busy';
		return status;
	}
</script>

{#snippet channelRow(channel: Channel)}
	<ChannelRow
		onclick={() => onSelectChannel(channel.id)}
		aria-current={isChannelActive(channel) ? 'true' : undefined}
		aria-label={channelAriaLabel(channel)}
		active={isChannelActive(channel)}
		data-active={isChannelActive(channel) ? 'true' : undefined}
		unread={Boolean(channel.unread)}
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
		<span class="flex h-[18px] w-[26px] shrink-0 items-center justify-center" aria-hidden="true">
			{#if channel.mentionCount}
				<Badge variant="notif">{channel.mentionCount}</Badge>
			{:else if channel.unread}
				<span class="text-xs leading-none text-foreground">✷</span>
			{/if}
		</span>
	</ChannelRow>
{/snippet}

<nav class="flex h-full w-full flex-col overflow-hidden bg-muted" aria-label={$t('design.channels.navigation')}>
	<div class="flex h-12 shrink-0 items-center gap-2 bg-muted px-4">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="flex min-w-0 flex-1 appearance-none items-center gap-1.5 border-0 bg-transparent p-0 font-inherit text-[15px] font-medium tracking-[0.01em] text-foreground shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						<span class="truncate">{squadName}</span>
						<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				<DropdownMenu.Item>{$t('design.channels.squadSettings')}</DropdownMenu.Item>
				<DropdownMenu.Item>{$t('design.channels.inviteMembers')}</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item variant="destructive" onclick={() => onLeaveSquad?.()}>
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
			<Search class="pointer-events-none absolute top-1/2 left-2 z-[1] size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				variant="sidebar"
				bind:value={searchTerm}
				placeholder={$t('design.channels.searchPlaceholder')}
				aria-label={$t('design.channels.search')}
			/>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
			{#if filteredChannels.length === 0}
				<p class="px-2 py-3 text-xs text-muted-foreground">{$t('design.channels.empty')}</p>
			{:else}
				{#if squadChannels.length > 0}
					<div class="flex items-center gap-1 px-2 pt-5 pb-1 text-[11px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
						{$t('design.channels.categorySquad')}
					</div>
					{#each squadChannels as channel (channel.id)}
						{@render channelRow(channel)}
					{/each}
				{/if}

				{#if otherChannels.length > 0}
					<div class="flex items-center gap-1 px-2 pt-5 pb-1 text-[11px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
						{$t('design.channels.categoryChannels')}
					</div>
					{#each otherChannels as channel (channel.id)}
						{@render channelRow(channel)}
					{/each}
				{/if}
			{/if}

			<Button variant="dashed" class="mt-1 h-8 w-full justify-start gap-1.5 text-[13.5px]" onclick={onAddChannel}>
				<Plus class="size-3.5" />
				<span>{$t('design.channels.addChannel')}</span>
			</Button>
		</div>

	<div class="flex h-[52px] shrink-0 items-center gap-2 bg-user-strip px-2">
		<PresenceAvatar
			initials={currentUser.initials}
			color={currentUser.color}
			presence={toPresence(presence)}
			ringClass="border-user-strip"
		/>
		<div class="flex h-8 min-w-0 flex-1 flex-col justify-center gap-1">
			<span class="truncate text-[13px] leading-4 font-semibold tracking-[0.01em] text-foreground">{currentUser.name}</span>
			<span class="truncate text-[11px] leading-3 text-muted-foreground">{presenceLabel}</span>
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
					<Button
						variant="ghost"
						onclick={() => onPresenceChange(status)}
						class={cn(
							'w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-foreground',
							status === presence && 'bg-accent',
						)}
					>
						<span class={cn('size-2.5 rounded-full', presenceDotClass[status])}></span>
						{$t(`design.presence.${status}`)}
					</Button>
				{/each}
			</Popover.Content>
		</Popover.Root>
	</div>
</nav>

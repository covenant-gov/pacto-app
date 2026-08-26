<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Bell from '@lucide/svelte/icons/bell';
	import Globe from '@lucide/svelte/icons/globe';
	import { t } from 'svelte-i18n';
	import type { RailLens, Squad } from '../fixtures.js';
	import { RailTile } from '../../../components/shell';

	let {
		squads,
		activeSquadId,
		dmCount,
		activityCount,
		onSelectSquad,
		onMarkSquadRead,
		onLeaveSquad,
		onAddSquad,
		onSelectLens,
		squadHasNotifications,
		activeLens = null,
	}: {
		squads: Squad[];
		activeSquadId: string;
		dmCount: number;
		activityCount: number;
		onSelectSquad: (id: string) => void;
		onMarkSquadRead: (id: string) => void;
		onLeaveSquad: (id: string) => void;
		onAddSquad: () => void;
		onSelectLens: (lens: RailLens) => void;
		squadHasNotifications: (id: string) => boolean;
		activeLens?: RailLens | null;
	} = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	<nav class="flex h-full w-full flex-col items-center gap-2 bg-transparent py-3" aria-label={$t('design.rail.navigation')}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<RailTile
						{...props}
						variant="surface"
						active={activeLens === 'home'}
						onclick={() => onSelectLens('home')}
						aria-label={$t('design.rail.home')}
						class="overflow-hidden"
					>
						<img
							src="/pacto-logo.png"
							alt=""
							width="30"
							height="30"
							class="size-[30px] object-contain"
							draggable="false"
						/>
					</RailTile>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{$t('design.rail.pacto')}</Tooltip.Content>
		</Tooltip.Root>

		<Separator class="my-1 h-0.5 w-8 rounded-sm" />

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<RailTile
						{...props}
						variant="surface"
						active={activeLens === 'dms'}
						onclick={() => onSelectLens('dms')}
						aria-label={$t('design.rail.dms')}
					>
						<MessageCircle class="size-5" />
						{#if dmCount > 0}
							<Badge variant="notif" class="absolute -right-0.5 -bottom-0.5 z-10 ring-3 ring-shell-rail">{dmCount}</Badge>
						{/if}
					</RailTile>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{$t('design.rail.dms')}</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<RailTile
						{...props}
						variant="surface"
						active={activeLens === 'activity'}
						onclick={() => onSelectLens('activity')}
						aria-label={$t('design.rail.activity')}
					>
						<Bell class="size-5" />
						{#if activityCount > 0}
							<Badge variant="notif" class="absolute -right-0.5 -bottom-0.5 z-10 ring-3 ring-shell-rail">
								{activityCount}
							</Badge>
						{/if}
					</RailTile>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{$t('design.rail.activity')}</Tooltip.Content>
		</Tooltip.Root>

		<Separator class="my-1 h-0.5 w-8 rounded-sm" />

		{#each squads as squad (squad.id)}
			<ContextMenu.Root>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<ContextMenu.Trigger>
								{#snippet child({ props: menuProps })}
									<RailTile
										{...props}
										{...menuProps}
										variant="squad"
										active={squad.id === activeSquadId}
										dim={!squad.unread && squad.id !== activeSquadId}
										onclick={() => onSelectSquad(squad.id)}
										aria-label={$t('design.rail.selectSquad', { values: { name: squad.name } })}
										aria-current={squad.id === activeSquadId ? 'true' : undefined}
										class="identity-fill"
										style={`--identity: ${squad.color}`}
									>
										<span class="text-sm font-semibold">{squad.initials}</span>
										{#if squad.mentionCount}
											<Badge variant="notif" class="absolute -right-0.5 -bottom-0.5 z-10 ring-3 ring-shell-rail">
												{squad.mentionCount}
											</Badge>
										{/if}
									</RailTile>
								{/snippet}
							</ContextMenu.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right">{squad.name}</Tooltip.Content>
				</Tooltip.Root>
				<ContextMenu.Content>
					<ContextMenu.Item
						disabled={!squadHasNotifications(squad.id)}
						onclick={() => onMarkSquadRead(squad.id)}
					>
						{$t('design.rail.markAsRead')}
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Item variant="destructive" onclick={() => onLeaveSquad(squad.id)}>
						{$t('design.rail.leave')}
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		{/each}

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<RailTile {...props} variant="add" onclick={onAddSquad} aria-label={$t('design.rail.addSquad')}>
						<Plus class="size-5" />
					</RailTile>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{$t('design.rail.addSquad')}</Tooltip.Content>
		</Tooltip.Root>

		<div class="flex-1"></div>

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<RailTile
						{...props}
						variant="transparent"
						active={activeLens === 'commons'}
						onclick={() => onSelectLens('commons')}
						aria-label={$t('design.rail.commons')}
					>
						<Globe class="size-5" />
					</RailTile>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{$t('design.rail.commons')}</Tooltip.Content>
		</Tooltip.Root>
	</nav>
</Tooltip.Provider>

<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';
	import Plus from '@lucide/svelte/icons/plus';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Bell from '@lucide/svelte/icons/bell';
	import Globe from '@lucide/svelte/icons/globe';
	import { t } from 'svelte-i18n';
	import type { RailLens, Squad } from '../fixtures.js';

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

	let markMenu = $state<{ squadId: string; x: number; y: number } | null>(null);

	const markReadEnabled = $derived(markMenu ? squadHasNotifications(markMenu.squadId) : false);

	function openMarkMenu(event: MouseEvent, squadId: string) {
		event.preventDefault();
		markMenu = { squadId, x: event.clientX, y: event.clientY };
	}

	function closeMarkMenu() {
		markMenu = null;
	}

	function markRead() {
		if (!markMenu || !squadHasNotifications(markMenu.squadId)) return;
		onMarkSquadRead(markMenu.squadId);
		closeMarkMenu();
	}

	function leaveSquad() {
		if (!markMenu) return;
		onLeaveSquad(markMenu.squadId);
		closeMarkMenu();
	}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (!markMenu) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('[data-mark-read-menu]')) return;
		closeMarkMenu();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') closeMarkMenu();
	}}
/>

<Tooltip.Provider delayDuration={300}>
<nav class="flex h-full w-full flex-col items-center gap-2 bg-transparent py-3" aria-label={$t('design.rail.navigation')}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					onclick={() => onSelectLens('home')}
					aria-label={$t('design.rail.home')}
					class={cn('rail-tile rail-tile--surface overflow-hidden', activeLens === 'home' && 'rail-tile--active')}
				>
					<img
						src="/pacto-logo.png"
						alt=""
						width="30"
						height="30"
						class="size-[30px] object-contain"
						draggable="false"
					/>
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">{$t('design.rail.pacto')}</Tooltip.Content>
	</Tooltip.Root>

	<div class="rail-divider"></div>

	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					onclick={() => onSelectLens('dms')}
					aria-label={$t('design.rail.dms')}
					class={cn('rail-tile rail-tile--surface', activeLens === 'dms' && 'rail-tile--active')}
				>
					<MessageCircle class="size-5 text-[var(--text-secondary)]" />
					{#if dmCount > 0}
						<span class="count-badge">{dmCount}</span>
					{/if}
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">{$t('design.rail.dms')}</Tooltip.Content>
	</Tooltip.Root>

	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					onclick={() => onSelectLens('activity')}
					aria-label={$t('design.rail.activity')}
					class={cn('rail-tile rail-tile--surface', activeLens === 'activity' && 'rail-tile--active')}
				>
					<Bell class="size-5 text-[var(--text-secondary)]" />
					{#if activityCount > 0}
						<span class="count-badge">{activityCount}</span>
					{/if}
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">{$t('design.rail.activity')}</Tooltip.Content>
	</Tooltip.Root>

	<div class="rail-divider"></div>

	{#each squads as squad (squad.id)}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						onclick={() => onSelectSquad(squad.id)}
						oncontextmenu={(event) => openMarkMenu(event, squad.id)}
						aria-label={$t('design.rail.selectSquad', { values: { name: squad.name } })}
						aria-current={squad.id === activeSquadId ? 'true' : undefined}
						class={cn(
							'rail-tile',
							!squad.unread && squad.id !== activeSquadId && 'rail-tile--dim',
							squad.id === activeSquadId && 'rail-tile--active',
						)}
						style={`background-color: ${squad.color};`}
					>
						<span class="text-sm font-semibold text-[var(--text-primary)]">{squad.initials}</span>
						{#if squad.mentionCount}
							<span class="count-badge">{squad.mentionCount}</span>
						{/if}
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{squad.name}</Tooltip.Content>
		</Tooltip.Root>
	{/each}

	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button {...props} type="button" onclick={onAddSquad} aria-label={$t('design.rail.addSquad')} class="rail-tile rail-tile--add">
					<Plus class="size-5" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">{$t('design.rail.addSquad')}</Tooltip.Content>
	</Tooltip.Root>

	<div class="flex-1"></div>

	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					onclick={() => onSelectLens('commons')}
					aria-label={$t('design.rail.commons')}
					class={cn(
						'rail-tile rail-tile--surface-transparent',
						activeLens === 'commons' && 'rail-tile--active',
					)}
				>
					<Globe class="size-5 text-[var(--text-secondary)]" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">{$t('design.rail.commons')}</Tooltip.Content>
	</Tooltip.Root>
</nav>
</Tooltip.Provider>

{#if markMenu}
	<div data-mark-read-menu role="menu" class="mark-menu" style={`left: ${markMenu.x}px; top: ${markMenu.y}px;`}>
		<button
			type="button"
			role="menuitem"
			class="mark-menu__item"
			class:mark-menu__item--muted={!markReadEnabled}
			disabled={!markReadEnabled}
			aria-disabled={!markReadEnabled}
			onclick={markRead}
		>
			{$t('design.rail.markAsRead')}
		</button>
		<div class="mark-menu__sep" role="separator"></div>
		<button type="button" role="menuitem" class="mark-menu__item mark-menu__item--danger" onclick={leaveSquad}>
			{$t('design.rail.leave')}
		</button>
	</div>
{/if}

<style>
	.count-badge {
		pointer-events: none;
		position: absolute;
		right: -3px;
		bottom: -3px;
		z-index: 10;
		display: flex;
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
		line-height: 1;
		box-shadow: 0 0 0 3px #060c17;
		font-variant-numeric: tabular-nums;
	}

	.mark-menu {
		position: fixed;
		z-index: 50;
		min-width: 11rem;
		padding: 4px;
		border-radius: 10px;
		background: var(--bg-page);
		color: var(--text-primary);
		font-size: 0.875rem;
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent),
			0 1px 2px rgba(0, 0, 0, 0.35),
			0 8px 24px rgba(0, 0, 0, 0.55),
			0 16px 40px rgba(0, 0, 0, 0.35);
	}

	.mark-menu__item {
		appearance: none;
		display: flex;
		width: 100%;
		align-items: center;
		border: 0;
		border-radius: 6px;
		background: transparent;
		box-shadow: none;
		padding: 6px 8px;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			transform 140ms var(--ease-out);
	}

	.mark-menu__item--danger {
		color: var(--danger);
	}

	.mark-menu__item--muted {
		color: var(--text-muted);
		cursor: default;
		opacity: 0.55;
	}

	.mark-menu__sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--border-subtle);
	}

	.mark-menu__item:active {
		transform: scale(0.96);
	}

	.mark-menu__item:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.mark-menu__item:hover:not(:disabled):not(.mark-menu__item--muted) {
			background: var(--bg-hover);
		}
	}

	.rail-divider {
		width: 32px;
		height: 2px;
		border-radius: 1px;
		background: var(--border-subtle);
		margin: 4px 0;
	}

	.rail-tile {
		-webkit-appearance: none;
		appearance: none;
		position: relative;
		display: flex;
		height: 48px;
		width: 48px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 0;
		outline: none;
		border-radius: 15px;
		background-color: transparent;
		background-image: none;
		box-shadow: none;
		cursor: pointer;
		transition:
			border-radius 160ms var(--ease-out),
			background-color 120ms ease,
			color 120ms ease,
			opacity 140ms ease,
			transform 140ms var(--ease-out);
	}

	.rail-tile--surface {
		border-radius: 16px;
		background: var(--bg-elevated);
	}

	.rail-tile--surface-transparent {
		border-radius: 16px;
	}

	.rail-tile--dim {
		opacity: 0.42;
	}

	.rail-tile--add {
		border-radius: 16px;
		border: 2px dotted var(--border-subtle);
		color: var(--text-muted);
		background: transparent;
	}

	.rail-tile--active::after {
		content: '';
		position: absolute;
		inset: -4px;
		z-index: 0;
		border: 2px solid var(--brand);
		border-radius: 19px;
		pointer-events: none;
	}

	.rail-tile:active {
		transform: scale(0.97);
	}

	.rail-tile:focus-visible {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 55%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.rail-tile--surface:hover,
		.rail-tile--surface-transparent:hover {
			border-radius: 13px;
			background: var(--bg-hover);
		}
		.rail-tile--surface:hover :global(svg),
		.rail-tile--surface-transparent:hover :global(svg) {
			color: var(--text-primary);
		}
		.rail-tile:not(.rail-tile--active):not(.rail-tile--add):hover {
			border-radius: 13px;
		}
		.rail-tile--dim:hover {
			opacity: 1;
		}
		.rail-tile--add:hover {
			border-radius: 13px;
			border-color: var(--border);
			color: var(--text-secondary);
			background: rgba(255, 255, 255, 0.04);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-tile,
		.mark-menu__item {
			transition: none;
		}
	}
</style>

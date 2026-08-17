<script lang="ts">
	import Gavel from '@lucide/svelte/icons/gavel';
	import Hash from '@lucide/svelte/icons/hash';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import type {
		NavRailLabels,
		ShellLens,
		ShellSelectCallback,
		ShellSquad,
	} from '$lib/shell';

	interface Props {
		lenses: readonly ShellLens[];
		squads: readonly ShellSquad[];
		activeLensId: string;
		activeSquadId: string;
		labels: NavRailLabels;
		onSelectLens: ShellSelectCallback;
		onSelectSquad: ShellSelectCallback;
	}

	let {
		lenses,
		squads,
		activeLensId,
		activeSquadId,
		labels,
		onSelectLens,
		onSelectSquad,
	}: Props = $props();
</script>

<nav class="rail h-full min-h-0 bg-[var(--bg-elevated)]" aria-label={labels.navigation}>
	<div class="rail-lenses">
		{#each lenses as lens (lens.id)}
			<button
				type="button"
				class:active={lens.id === activeLensId}
				class="rail-action"
				aria-label={labels.selectLens(lens.label)}
				aria-current={lens.id === activeLensId ? 'page' : undefined}
				onclick={() => onSelectLens(lens.id)}
			>
				{#if lens.kind === 'dashboard'}
					<LayoutDashboard class="size-[18px]" aria-hidden="true" />
				{:else if lens.kind === 'governance'}
					<Gavel class="size-[18px]" aria-hidden="true" />
				{:else if lens.kind === 'chat'}
					<MessageCircle class="size-[18px]" aria-hidden="true" />
				{:else}
					<Hash class="size-[18px]" aria-hidden="true" />
				{/if}
			</button>
		{/each}
	</div>

	<div class="rail-divider" aria-hidden="true"></div>

	<div class="rail-squads">
		{#each squads as squad (squad.id)}
			<button
				type="button"
				class:active={squad.id === activeSquadId}
				class="squad-action"
				aria-label={labels.selectSquad(squad.name)}
				aria-current={squad.id === activeSquadId ? 'page' : undefined}
				title={squad.name}
				onclick={() => onSelectSquad(squad.id)}
			>
				<span class="squad-initials" aria-hidden="true">{squad.initials}</span>
				{#if squad.unreadCount}
					<span class="unread-badge" aria-label={labels.unreadCount(squad.unreadCount)}>
						{squad.unreadCount > 99 ? '99+' : squad.unreadCount}
					</span>
				{/if}
			</button>
		{/each}
	</div>
</nav>

<style>
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		overflow: hidden;
		padding: 8px;
	}

	.rail-lenses {
		display: grid;
		gap: 6px;
	}

	.rail-action,
	.squad-action {
		appearance: none;
		position: relative;
		display: inline-flex;
		width: 44px;
		height: 44px;
		flex: none;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 12px;
		background: var(--bg-panel);
		box-shadow: none;
		color: var(--text-secondary);
		touch-action: manipulation;
		transition:
			transform 140ms var(--ease-out),
			background-color 140ms ease,
			color 140ms ease;
	}

	.rail-action.active,
	.squad-action.active {
		border-radius: 8px;
		background: var(--brand);
		color: var(--on-brand);
	}

	.rail-action:active,
	.squad-action:active {
		transform: scale(0.96);
	}

	.rail-action:focus-visible,
	.squad-action:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	.rail-divider {
		width: 32px;
		height: 1px;
		margin: 9px 0;
		background: var(--border-subtle);
	}

	.rail-squads {
		display: grid;
		min-height: 0;
		gap: 8px;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1px 4px 8px;
		scrollbar-width: none;
	}

	.rail-squads::-webkit-scrollbar {
		display: none;
	}

	.squad-initials {
		max-width: 36px;
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.unread-badge {
		position: absolute;
		right: -5px;
		bottom: -4px;
		display: inline-flex;
		min-width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--bg-elevated);
		border-radius: 999px;
		background: var(--notif);
		color: #fff;
		font-family: var(--font-mono-family);
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		line-height: 1;
		padding: 0 3px;
	}

	@media (hover: hover) and (pointer: fine) {
		.rail-action:not(.active):hover,
		.squad-action:not(.active):hover {
			border-radius: 8px;
			background: var(--bg-hover);
			color: var(--text-primary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-action,
		.squad-action {
			transition-duration: 1ms;
		}
	}

	@media (max-width: 720px) {
		.rail {
			padding-inline: 6px;
		}
	}
</style>

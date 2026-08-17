<script lang="ts">
	import Hash from '@lucide/svelte/icons/hash';
	import Lock from '@lucide/svelte/icons/lock';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import {
		groupShellChannels,
		type ChannelSidebarLabels,
		type ShellChannel,
		type ShellLens,
		type ShellSelectCallback,
	} from '$lib/shell';

	interface Props {
		squadName: string;
		lenses: readonly ShellLens[];
		channels: readonly ShellChannel[];
		activeLensId: string;
		activeChannelId: string;
		filter: string;
		labels: ChannelSidebarLabels;
		onSelectLens: ShellSelectCallback;
		onSelectChannel: ShellSelectCallback;
		onFilterChange: (value: string) => void;
	}

	let {
		squadName,
		lenses,
		channels,
		activeLensId,
		activeChannelId,
		filter,
		labels,
		onSelectLens,
		onSelectChannel,
		onFilterChange,
	}: Props = $props();

	const groups = $derived(groupShellChannels(channels));

	function handleFilterInput(event: Event): void {
		onFilterChange((event.currentTarget as HTMLInputElement).value);
	}

	function channelAriaLabel(channel: ShellChannel): string {
		const parts = [labels.selectChannel(channel.name)];
		if (channel.mentionCount) {
			parts.push(labels.mentions(channel.mentionCount));
		} else if (channel.unread) {
			parts.push(labels.unread);
		}
		return parts.join(', ');
	}
</script>

<aside
	class="channel-sidebar h-full min-h-0 bg-[var(--bg-panel)]"
	aria-label={labels.navigation}
>
	<header class="sidebar-header">
		<h2 title={squadName}>{squadName}</h2>
	</header>

	<div class="lens-list" role="tablist" aria-label={labels.navigation}>
		{#each lenses as lens (lens.id)}
			<button
				type="button"
				role="tab"
				class:active={lens.id === activeLensId}
				aria-selected={lens.id === activeLensId}
				onclick={() => onSelectLens(lens.id)}
			>
				{lens.label}
			</button>
		{/each}
	</div>

	<div class="channel-search">
		<Search
			class="pointer-events-none absolute top-1/2 left-[9px] z-[1] size-3.5 -translate-y-1/2 text-[var(--text-muted)]"
			aria-hidden="true"
		/>
		<input
			type="search"
			class="channel-filter"
			name="channel-filter"
			value={filter}
			autocorrect="off"
			autocomplete="off"
			spellcheck="false"
			aria-label={labels.search}
			placeholder={labels.searchPlaceholder}
			oninput={handleFilterInput}
		/>
	</div>

	<div class="channel-scroll">
		{#if groups.length}
			{#each groups as group (group.id)}
				<section class="channel-group" aria-labelledby={`channel-group-${group.id}`}>
					<h3 id={`channel-group-${group.id}`}>{group.label}</h3>
					{#each group.channels as channel (channel.id)}
						<button
							type="button"
							class:active={channel.id === activeChannelId}
							class:unread={channel.unread}
							class="channel-row"
							aria-label={channelAriaLabel(channel)}
							aria-current={channel.id === activeChannelId ? 'page' : undefined}
							onclick={() => onSelectChannel(channel.id)}
						>
							{#if channel.kind === 'private'}
								<Lock class="size-3.5 shrink-0" aria-hidden="true" />
							{:else if channel.kind === 'announcement'}
								<Megaphone class="size-3.5 shrink-0" aria-hidden="true" />
							{:else}
								<Hash class="size-3.5 shrink-0" aria-hidden="true" />
							{/if}
							<span class="min-w-0 flex-1 truncate text-left">{channel.name}</span>
							<span class="channel-status-slot" aria-hidden="true">
								{#if channel.mentionCount}
									<span class="mention-count">{channel.mentionCount}</span>
								{:else if channel.unread}
									<span class="channel-unread-mark">✷</span>
								{/if}
							</span>
						</button>
					{/each}
				</section>
			{/each}
		{:else}
			<p class="empty-channels" role="status">{labels.empty}</p>
		{/if}
	</div>
</aside>

<style>
	.channel-sidebar {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.sidebar-header {
		display: flex;
		height: 48px;
		flex: none;
		align-items: center;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 14px;
	}

	.sidebar-header h2 {
		min-width: 0;
		overflow: hidden;
		font-size: 0.9375rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lens-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 2px;
		margin: 8px;
		padding: 3px;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-elevated);
	}

	.lens-list button {
		appearance: none;
		min-width: 0;
		height: 28px;
		overflow: hidden;
		border: 0;
		border-radius: 5px;
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
		font-size: 0.6875rem;
		font-weight: 600;
		text-overflow: ellipsis;
		touch-action: manipulation;
		white-space: nowrap;
	}

	.lens-list button.active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.lens-list button:focus-visible,
	.channel-row:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	.channel-search {
		position: relative;
		margin: 0 8px 4px;
	}

	.channel-filter {
		width: 100%;
		height: 30px;
		appearance: none;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-elevated);
		padding: 0 8px 0 28px;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 0.75rem;
		outline: none;
	}

	.channel-filter::placeholder {
		color: var(--text-muted);
	}

	.channel-filter:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 35%, transparent);
	}

	.channel-scroll {
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 8px 12px;
	}

	.channel-group h3 {
		padding: 14px 8px 4px;
		color: var(--text-muted);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.channel-row {
		appearance: none;
		position: relative;
		display: flex;
		width: 100%;
		height: 32px;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		box-shadow: none;
		padding: 0 8px;
		color: var(--text-muted);
		font-size: 0.875rem;
		touch-action: manipulation;
		transition:
			transform 120ms var(--ease-out),
			background-color 120ms ease,
			color 120ms ease;
	}

	.channel-row.unread {
		color: var(--text-primary);
		font-weight: 600;
	}

	.channel-row.active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.channel-row:active {
		transform: scale(0.985);
	}

	.mention-count {
		display: inline-flex;
		min-width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--notif);
		color: #fff;
		font-family: var(--font-mono-family);
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		padding: 0 4px;
	}

	.channel-status-slot {
		display: flex;
		width: 26px;
		height: 18px;
		flex: none;
		align-items: center;
		justify-content: center;
	}

	.channel-unread-mark {
		color: var(--text-primary);
		font-size: 12px;
		line-height: 1;
	}

	.empty-channels {
		margin: 16px 8px;
		color: var(--text-muted);
		font-size: 0.8125rem;
		line-height: 1.4;
	}

	@media (hover: hover) and (pointer: fine) {
		.lens-list button:not(.active):hover,
		.channel-row:not(.active):hover {
			background: rgba(255, 255, 255, 0.04);
			color: var(--text-secondary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.channel-row {
			transition-duration: 1ms;
		}
	}
</style>

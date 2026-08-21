<script lang="ts">
	import Hash from '@lucide/svelte/icons/hash';
	import Lock from '@lucide/svelte/icons/lock';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		groupShellChannels,
		type ChannelSidebarLabels,
		type ShellChannel,
		type ShellLens,
		type ShellSelectCallback,
	} from '$lib/shell';
	import ChannelRow from './ChannelRow.svelte';

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

<aside class="flex h-full min-h-0 flex-col overflow-hidden bg-muted" aria-label={labels.navigation}>
	<header class="flex h-12 shrink-0 items-center px-3.5">
		<h2 class="min-w-0 truncate text-[0.9375rem] font-semibold tracking-[-0.01em]" title={squadName}>
			{squadName}
		</h2>
	</header>

	<div class="m-2 grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-secondary p-0.5" role="tablist" aria-label={labels.navigation}>
		{#each lenses as lens (lens.id)}
			<Button
				variant="tab"
				size="sm"
				role="tab"
				class="h-7 min-w-0 overflow-hidden text-[0.6875rem]"
				aria-selected={lens.id === activeLensId}
				aria-current={lens.id === activeLensId ? 'page' : undefined}
				onclick={() => onSelectLens(lens.id)}
			>
				{lens.label}
			</Button>
		{/each}
	</div>

	<div class="relative mx-2 mb-1">
		<Search
			class="pointer-events-none absolute top-1/2 left-[9px] z-[1] size-3.5 -translate-y-1/2 text-muted-foreground"
			aria-hidden="true"
		/>
		<Input
			type="search"
			size="sm"
			class="h-[30px] rounded-md border border-border bg-secondary pl-7"
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

	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
			{#if groups.length}
				{#each groups as group (group.id)}
					<section class="channel-group" aria-labelledby={`channel-group-${group.id}`}>
						<h3
							id={`channel-group-${group.id}`}
							class="px-2 pt-3.5 pb-1 text-[0.6875rem] font-bold tracking-[0.07em] text-muted-foreground uppercase"
						>
							{group.label}
						</h3>
						{#each group.channels as channel (channel.id)}
							<ChannelRow
								active={channel.id === activeChannelId}
								unread={Boolean(channel.unread)}
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
								<span class="flex h-[18px] w-[26px] shrink-0 items-center justify-center" aria-hidden="true">
									{#if channel.mentionCount}
										<Badge variant="notif">{channel.mentionCount}</Badge>
									{:else if channel.unread}
										<span class="text-xs leading-none text-foreground">✷</span>
									{/if}
								</span>
							</ChannelRow>
						{/each}
					</section>
				{/each}
			{:else}
				<p class="m-4 mx-2 text-[0.8125rem] leading-snug text-muted-foreground" role="status">{labels.empty}</p>
			{/if}
	</div>
</aside>

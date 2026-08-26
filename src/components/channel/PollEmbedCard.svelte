<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import Check from '@lucide/svelte/icons/check';
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils.js';
	import { embedCardClass } from './embed-surface.js';
	import PollEmbedHeading from './PollEmbedHeading.svelte';

	let {
		title,
		channel,
		tag,
		closes,
		options,
	}: {
		title: string;
		channel: string;
		tag?: string;
		closes: string;
		options: {
			label: string;
			votes: number;
			selected?: boolean;
			voters?: { initials: string; color: string }[];
		}[];
	} = $props();

	const seededPick = $derived(options.findIndex((option) => option.selected));
	let picked = $state<number | null>(null);

	const activePick = $derived(picked ?? (seededPick >= 0 ? seededPick : null));
	const total = $derived(options.reduce((sum, option) => sum + option.votes, 0));
	const leadVotes = $derived(options.reduce((max, option) => Math.max(max, option.votes), 0));
	const interactive = $derived(options.length > 0);

	function pick(index: number) {
		if (!interactive) return;
		picked = index;
	}

	function formatVoteCount(votes: number): string {
		return votes > 99 ? '99+' : String(votes);
	}
</script>

<Card.Root class={embedCardClass}>
	<Card.Header class="grid-cols-[minmax(0,1fr)_auto] gap-1.5">
		<PollEmbedHeading {title} {channel} {tag} titleClass="col-span-2 text-pretty" />
		{#if interactive}
			<Card.Description class="col-span-2 text-xs">{$t('design.chat.selectOne')}</Card.Description>
		{/if}
	</Card.Header>

	<Card.Content>
		{#if options.length === 0}
			<p class="m-0 text-sm text-muted-foreground">{$t('design.chat.pollEmpty')}</p>
		{:else}
			<div
				class="flex flex-col gap-3"
				role={interactive ? 'radiogroup' : 'list'}
				aria-label={title}
			>
				{#each options as option, index (option.label)}
					{@const pct = total === 0 ? 0 : Math.round((option.votes / total) * 100)}
					{@const selected = activePick === index}
					{@const leading = option.votes === leadVotes && leadVotes > 0}
					{@const rowClass = cn(
						'grid w-full min-w-0 appearance-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-lg border-0 bg-transparent px-2.5 py-2.5 text-left font-inherit shadow-none outline-none transition-[transform,background-color] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
						interactive &&
							'cursor-pointer hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]',
						selected && 'bg-accent',
					)}
					<svelte:element
						this={interactive ? 'button' : 'div'}
						class={rowClass}
						role={interactive ? 'radio' : 'listitem'}
						type={interactive ? 'button' : undefined}
						aria-checked={interactive ? selected : undefined}
						aria-label={$t('design.chat.optionVotes', {
							values: { label: option.label, votes: option.votes, pct },
						})}
						onclick={interactive ? () => pick(index) : undefined}
					>
						<span
							class={cn(
								'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums ring-1 ring-border',
								selected
									? 'bg-primary text-primary-foreground ring-primary'
									: 'bg-secondary text-muted-foreground',
							)}
							aria-hidden="true"
						>
							{#if selected}
								<Check class="size-3" />
							{:else}
								{String.fromCharCode(65 + index)}
							{/if}
						</span>
						<span
							class={cn(
								'min-w-0 truncate text-[13px] leading-snug',
								selected ? 'font-medium text-foreground' : 'text-secondary-foreground',
							)}
						>
							{option.label}
						</span>
						<span class="flex min-w-0 items-center justify-end gap-1.5">
							{#if option.voters && option.voters.length > 0}
								<Avatar.Group class="-space-x-1">
									{#each option.voters.slice(0, 3) as voter (voter.initials + voter.color)}
										<Avatar.Root size="sm" class="size-4">
											<Avatar.Fallback
												class="identity-fill text-[7px] font-semibold"
												style={`--identity: ${voter.color}`}
											>
												{voter.initials}
											</Avatar.Fallback>
										</Avatar.Root>
									{/each}
								</Avatar.Group>
							{/if}
							<span
								class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-secondary px-1 text-[10px] leading-none font-semibold text-secondary-foreground tabular-nums"
							>
								{formatVoteCount(option.votes)}
							</span>
						</span>
						<span class="col-start-2 col-end-4 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
							<span
								class={cn(
									'block h-full w-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none',
									leading ? 'bg-primary/55' : 'bg-primary/28',
									selected && 'bg-primary/80',
								)}
								style={`transform: scaleX(${pct / 100})`}
							></span>
						</span>
					</svelte:element>
				{/each}
			</div>
		{/if}
	</Card.Content>

	<Card.Footer class="justify-between gap-3 border-border/80">
		<p class="m-0 min-w-0 text-xs leading-snug text-muted-foreground">
			<span class="tabular-nums text-secondary-foreground">{$t('design.chat.voted', { values: { count: total } })}</span>
			<span aria-hidden="true"> · </span>
			<span>{$t('design.chat.expires', { values: { when: closes } })}</span>
			{#if activePick !== null}
				<span aria-hidden="true"> · </span>
				<span class="text-mention-accent">{$t('design.chat.voteRecorded')}</span>
			{/if}
		</p>
	</Card.Footer>
</Card.Root>

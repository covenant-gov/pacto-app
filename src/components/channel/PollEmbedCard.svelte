<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { t } from 'svelte-i18n';

	let {
		title,
		channel,
		tag,
		closes,
		options,
		announcementOnly = false,
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
		announcementOnly?: boolean;
	} = $props();

	const total = $derived(options.reduce((sum, option) => sum + option.votes, 0) || 1);
</script>

<Card.Root class="mt-1 max-w-[440px] rounded-xl bg-muted p-3 shadow-[0_8px_24px_rgba(0,0,0,0.28)]" size="sm">
	<div class="flex items-center justify-between gap-2 px-0">
		<div class="flex flex-wrap items-center gap-1.5">
			<Badge variant="brand-soft">{tag ?? $t('design.chat.pollTag')}</Badge>
			<Badge variant="secondary">#{channel}</Badge>
		</div>
		<Badge variant="danger-soft" class="tabular-nums">{closes}</Badge>
	</div>
	<Card.Title class="mt-2 text-[15px] font-semibold text-balance">{title}</Card.Title>
	<div class="mt-3 flex flex-col gap-2">
		{#each options as option, index (option.label)}
			{@const pct = Math.round((option.votes / total) * 100)}
			{@const letter = String.fromCharCode(65 + index)}
			<button
				type="button"
				class="relative flex h-auto w-full appearance-none cursor-pointer items-center gap-2 overflow-hidden rounded-lg border-0 bg-secondary/85 bg-none px-2.5 py-2 text-left font-inherit text-[13px] text-secondary-foreground shadow-none outline-none transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 before:absolute before:inset-y-0 before:left-0 before:w-[var(--pct)] before:bg-primary/16"
				class:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_50%,transparent)]={option.selected}
				class:text-foreground={option.selected}
				style={`--pct: ${pct}%;`}
			>
				<span
					class="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-foreground"
				>
					{letter}
				</span>
				<span class="relative z-10 min-w-0 flex-1 truncate text-left">{option.label}</span>
				{#if option.voters && option.voters.length > 0}
					<span class="relative z-10 flex shrink-0 items-center">
						<Avatar.Group class="-space-x-1.5">
							{#each option.voters.slice(0, 3) as voter (voter.initials + voter.color)}
								<Avatar.Root size="sm" class="size-[18px] ring-2 ring-muted">
									<Avatar.Fallback
										class="identity-fill text-[8px] font-semibold"
										style={`--identity: ${voter.color}`}
									>
										{voter.initials}
									</Avatar.Fallback>
								</Avatar.Root>
							{/each}
						</Avatar.Group>
					</span>
				{/if}
				<span class="relative z-10 shrink-0 text-xs tabular-nums text-muted-foreground">{option.votes} · {pct}%</span>
			</button>
		{/each}
	</div>
	<div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
		<span>{$t('design.chat.expires', { values: { when: closes } })}</span>
		<span class="tabular-nums text-secondary-foreground">{$t('design.chat.voted', { values: { count: total } })}</span>
	</div>
	{#if announcementOnly}
		<div class="mt-3 rounded-lg bg-secondary px-3 py-2 text-center text-xs font-medium text-secondary-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]">
			{$t('design.chat.openToVote', { values: { channel } })}
		</div>
	{/if}
</Card.Root>

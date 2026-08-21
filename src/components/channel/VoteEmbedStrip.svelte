<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils.js';
	import { embedKickerClass, embedStripFrameClass } from './embed-surface.js';

	let {
		title,
		channel,
		amount,
		tag,
		proposalId,
		closes,
		forPct = 50,
		againstPct = 50,
		quorumNeeded,
	}: {
		title: string;
		channel: string;
		amount: string;
		tag?: string;
		proposalId?: number;
		closes?: string;
		forPct?: number;
		againstPct?: number;
		quorumNeeded?: number;
	} = $props();

	const forShare = $derived(Math.min(Math.max(forPct, 0), 100) / 100);
	const quorumShare = $derived(
		quorumNeeded == null ? null : Math.min(Math.max(quorumNeeded, 0), 100),
	);
	const quorumMet = $derived(quorumShare != null && forPct >= quorumShare);
</script>

<button
	type="button"
	class={embedStripFrameClass}
	aria-label={$t('design.chat.openProposal', { values: { channel, title } })}
>
	<Card.Header class="grid-cols-[minmax(0,1fr)_auto] gap-1">
		<p class={embedKickerClass}>
			<span class="font-medium tracking-[0.04em] text-gov-success uppercase">
				{tag ?? $t('design.chat.proposalFallback')}
			</span>
			<span aria-hidden="true">·</span>
			<span>{$t('design.chat.voteTreasury')}</span>
		</p>
		{#if closes}
			<Card.Action class="flex items-center gap-1 text-xs leading-none text-muted-foreground tabular-nums">
				<Clock class="size-3" aria-hidden="true" />
				<span>{closes}</span>
			</Card.Action>
		{/if}
		<Card.Title class="col-span-2 line-clamp-2 min-h-10 text-pretty">
			{#if proposalId}
				<span class="mr-1.5 font-medium text-muted-foreground tabular-nums">#{proposalId}</span>
			{/if}
			{title}
		</Card.Title>
	</Card.Header>

	<Card.Content class="flex min-h-0 flex-1 flex-col justify-end gap-2">
		<div class="flex h-5 min-w-0 items-baseline justify-between gap-2">
			<span class="shrink-0 text-[13px] leading-5 font-semibold text-foreground tabular-nums">{amount}</span>
			<span class="min-w-0 truncate text-[13px] leading-5">
				<span class="text-gov-success tabular-nums">{$t('design.chat.forPct', { values: { pct: forPct } })}</span>
				<span class="text-muted-foreground"> · </span>
				<span class="text-destructive tabular-nums">{$t('design.chat.againstPct', { values: { pct: againstPct } })}</span>
			</span>
		</div>
		<div class="relative h-1.5 rounded-full bg-muted" aria-hidden="true">
				<span
					class={cn(
						'absolute inset-y-0 left-0 w-full origin-left rounded-full',
						quorumMet ? 'bg-gov-success' : 'bg-gov-success/45',
					)}
					style={`transform: scaleX(${forShare})`}
				></span>
				{#if quorumShare != null}
					<span
						class="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
						style={`left: ${quorumShare}%`}
					></span>
				{/if}
			</div>
		</Card.Content>

		<Card.Footer class="mt-auto border-border/80">
		<p class="m-0 min-w-0 truncate text-xs leading-snug text-muted-foreground">
				{#if quorumShare != null}
					<span class={cn('tabular-nums', quorumMet && 'text-gov-success')}>
						{$t('design.chat.quorumNeeded', { values: { pct: quorumShare } })}
					</span>
					<span aria-hidden="true"> · </span>
				{/if}
				{$t('design.chat.openInChannel', { values: { channel } })}
			</p>
		</Card.Footer>
</button>

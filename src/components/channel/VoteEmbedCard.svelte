<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils.js';

	let {
		title,
		detail,
		amount,
		quorum,
		tag,
		proposalId,
		closes,
		forPct = 50,
		againstPct = 50,
		quorumNeeded,
		announcementOnly = false,
	}: {
		title: string;
		detail: string;
		amount: string;
		quorum: string;
		tag?: string;
		proposalId?: number;
		closes?: string;
		forPct?: number;
		againstPct?: number;
		quorumNeeded?: number;
		announcementOnly?: boolean;
	} = $props();

	let stance = $state<'for' | 'against' | null>(null);

	const forShare = $derived(Math.min(Math.max(forPct, 0), 100) / 100);
	const againstShare = $derived(Math.min(Math.max(againstPct, 0), 100) / 100);
	const quorumShare = $derived(
		quorumNeeded == null ? null : Math.min(Math.max(quorumNeeded, 0), 100),
	);
	const quorumMet = $derived(quorumShare != null && forPct >= quorumShare);
</script>

<Card.Root class="max-w-110 overflow-hidden">
	<Card.Header class="grid-cols-[minmax(0,1fr)_auto] gap-1.5">
		<p class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-none text-muted-foreground">
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
		<Card.Title class="min-w-0 text-pretty">
			{#if proposalId}
				<span class="mr-1.5 font-medium text-muted-foreground tabular-nums">#{proposalId}</span>
			{/if}
			{title}
		</Card.Title>
		<Card.Description class="col-span-2 text-sm leading-relaxed text-pretty">{detail}</Card.Description>
	</Card.Header>

	<Card.Content class="flex flex-col gap-4">
		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-1.5">
			<div class="min-w-0">
				<p class="m-0 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
					{$t('design.chat.amount')}
				</p>
				<p class="m-0 text-lg leading-none font-semibold text-foreground tabular-nums">{amount}</p>
			</div>
			<div class="text-right">
				<p class="m-0 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
					{$t('design.chat.quorum')}
				</p>
				<p class="m-0 text-[13px] leading-none font-medium text-foreground tabular-nums">
					<span class={quorumMet ? 'text-gov-success' : undefined}>{forPct}%</span>
					{#if quorumShare != null}
						<span class="text-muted-foreground">
							· {$t('design.chat.quorumNeeded', { values: { pct: quorumShare } })}
						</span>
					{:else}
						<span class="text-muted-foreground">{quorum}</span>
					{/if}
				</p>
			</div>
			<div class="relative col-span-2 h-2 rounded-full bg-secondary" aria-hidden="true">
				<span
					class={cn(
						'absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none',
						quorumMet ? 'bg-gov-success' : 'bg-gov-success/45',
					)}
					style={`transform: scaleX(${forShare})`}
				></span>
				{#if quorumShare != null}
					<span
						class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
						style={`left: ${quorumShare}%`}
					></span>
				{/if}
			</div>
		</div>

		<div class="grid gap-3">
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
				<span class="text-xs font-medium text-gov-success">{$t('design.chat.for')}</span>
				<span class="text-xs text-gov-success tabular-nums">{forPct}%</span>
				<span class="col-span-2 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
					<span
						class="block h-full w-full origin-left rounded-full bg-gov-success transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none"
						style={`transform: scaleX(${forShare})`}
					></span>
				</span>
			</div>
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
				<span class="text-xs font-medium text-destructive">{$t('design.chat.against')}</span>
				<span class="text-xs text-destructive tabular-nums">{againstPct}%</span>
				<span class="col-span-2 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
					<span
						class="block h-full w-full origin-left rounded-full bg-destructive/80 transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none"
						style={`transform: scaleX(${againstShare})`}
					></span>
				</span>
			</div>
		</div>
	</Card.Content>

	<Card.Footer class="border-border/80">
		{#if announcementOnly}
			<div class="flex w-full items-center justify-between gap-3">
				<p class="m-0 min-w-0 text-xs leading-snug text-muted-foreground">
					<span class="text-gov-success">{$t('design.chat.forPct', { values: { pct: forPct } })}</span>
					<span aria-hidden="true"> · </span>
					<span class="text-destructive">{$t('design.chat.againstPct', { values: { pct: againstPct } })}</span>
				</p>
				<Button variant="ghost" size="sm" class="h-auto shrink-0 px-1.5 py-1 text-xs text-mention-accent">
					{$t('design.chat.castOnTreasury')}
					<ChevronRight class="size-3.5" />
				</Button>
			</div>
		{:else}
			<div class="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
				<Button
					variant="success"
					class="h-9"
					aria-pressed={stance === 'for'}
					onclick={() => (stance = 'for')}
				>
					{$t('design.chat.voteFor')}
				</Button>
				<Button
					variant="danger-soft"
					class="h-9"
					aria-pressed={stance === 'against'}
					onclick={() => (stance = 'against')}
				>
					{$t('design.chat.voteAgainst')}
				</Button>
			</div>
		{/if}
	</Card.Footer>
</Card.Root>

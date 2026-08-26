<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils.js';
	import { embedCardClass } from './embed-surface.js';
	import VoteEmbedHeading from './VoteEmbedHeading.svelte';

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
	} = $props();

	let stance = $state<'for' | 'against' | null>(null);

	const forShare = $derived(Math.min(Math.max(forPct, 0), 100) / 100);
	const againstShare = $derived(Math.min(Math.max(againstPct, 0), 100) / 100);
	const quorumShare = $derived(
		quorumNeeded == null ? null : Math.min(Math.max(quorumNeeded, 0), 100),
	);
	const quorumMet = $derived(quorumShare != null && forPct >= quorumShare);
</script>

<Card.Root class={embedCardClass}>
	<Card.Header class="grid-cols-[minmax(0,1fr)_auto] gap-1.5">
		<VoteEmbedHeading {title} {tag} {proposalId} {closes} titleClass="min-w-0 text-pretty" />
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
		<div
			class="grid w-full grid-cols-2 overflow-hidden rounded-lg border border-border"
			role="group"
			aria-label={$t('design.chat.voteStance')}
		>
			<button
				type="button"
				class={cn(
					'appearance-none inline-flex h-9 items-center justify-center gap-1.5 border-0 border-r border-solid border-border bg-transparent text-sm font-medium text-foreground',
					'hover:bg-accent focus-visible:z-1 focus-visible:ring-3 focus-visible:ring-ring/50',
					'active:scale-[0.99] motion-reduce:active:scale-100',
					stance === 'for' && 'bg-accent',
				)}
				aria-pressed={stance === 'for'}
				onclick={() => (stance = 'for')}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-gov-success" aria-hidden="true"></span>
				{$t('design.chat.voteFor')}
			</button>
			<button
				type="button"
				class={cn(
					'appearance-none inline-flex h-9 items-center justify-center gap-1.5 border-0 bg-transparent text-sm font-medium text-foreground',
					'hover:bg-accent focus-visible:z-1 focus-visible:ring-3 focus-visible:ring-ring/50',
					'active:scale-[0.99] motion-reduce:active:scale-100',
					stance === 'against' && 'bg-accent',
				)}
				aria-pressed={stance === 'against'}
				onclick={() => (stance = 'against')}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
				{$t('design.chat.voteAgainst')}
			</button>
		</div>
	</Card.Footer>
</Card.Root>

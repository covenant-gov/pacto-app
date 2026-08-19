<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { t } from 'svelte-i18n';

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
		announcementOnly?: boolean;
	} = $props();
</script>

<Card.Root
	class="mt-1 max-w-[440px] rounded-xl bg-muted p-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--gov-success)_35%,var(--border-subtle)),0_8px_24px_rgba(0,0,0,0.28)]"
	size="sm"
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex flex-wrap items-center gap-1.5">
			<Badge variant="warning-soft">{tag ?? $t('design.chat.proposalFallback')}</Badge>
			<Badge variant="secondary">{$t('design.chat.voteTreasury')}</Badge>
		</div>
		{#if closes}
			<Badge variant="danger-soft" class="tabular-nums">{closes}</Badge>
		{/if}
	</div>
	<Card.Title class="mt-2 text-[15px] font-semibold text-balance">
		{#if proposalId}
			<span class="mr-1.5 tabular-nums text-warning opacity-90">#{proposalId}</span>
		{/if}
		{title}
	</Card.Title>
	<p class="mt-1 text-[13px] leading-snug text-pretty text-muted-foreground">{detail}</p>
	<div class="mt-3 grid grid-cols-3 gap-2">
		<div class="flex flex-col gap-0.5 rounded-lg bg-secondary p-2">
			<span class="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
				{$t('design.chat.amount')}
			</span>
			<span class="text-[13px] font-semibold text-foreground tabular-nums">{amount}</span>
		</div>
		<div class="flex flex-col gap-0.5 rounded-lg bg-secondary p-2">
			<span class="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
				{$t('design.chat.for')}
			</span>
			<span class="text-[13px] font-semibold text-gov-success tabular-nums">{forPct}%</span>
		</div>
		<div class="flex flex-col gap-0.5 rounded-lg bg-secondary p-2">
			<span class="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
				{$t('design.chat.quorum')}
			</span>
			<span class="text-[13px] font-semibold text-foreground tabular-nums">{quorum}</span>
		</div>
	</div>
	<div class="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" style={`--for: ${forPct}%; --against: ${againstPct}%`}>
		<span class="h-full rounded-l-full rounded-r-sm bg-gov-success" style="width: var(--for)"></span>
		<span class="h-full rounded-l-sm rounded-r-full bg-destructive/85" style="width: var(--against)"></span>
	</div>
	<div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
		<span class="text-gov-success">{$t('design.chat.forPct', { values: { pct: forPct } })}</span>
		<span class="text-destructive">{$t('design.chat.againstPct', { values: { pct: againstPct } })}</span>
	</div>
	{#if announcementOnly}
		<div class="mt-3 rounded-lg bg-secondary px-3 py-2 text-center text-xs font-medium text-secondary-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]">
			{$t('design.chat.castOnTreasury')}
		</div>
	{:else}
		<div class="mt-3 grid grid-cols-2 gap-2">
			<Button variant="success" class="h-9">{$t('design.chat.voteFor')}</Button>
			<Button variant="danger-soft" class="h-9">{$t('design.chat.voteAgainst')}</Button>
		</div>
	{/if}
</Card.Root>

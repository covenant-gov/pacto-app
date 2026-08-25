<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import { t } from 'svelte-i18n';
	import { embedKickerClass } from './embed-surface.js';

	let {
		title,
		tag,
		proposalId,
		closes,
		titleClass,
	}: {
		title: string;
		tag?: string;
		proposalId?: number;
		closes?: string;
		titleClass: string;
	} = $props();
</script>

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
<Card.Title class={titleClass}>
	{#if proposalId}
		<span class="mr-1.5 font-medium text-muted-foreground tabular-nums">#{proposalId}</span>
	{/if}
	{title}
</Card.Title>

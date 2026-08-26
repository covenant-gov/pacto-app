<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import { t } from 'svelte-i18n';
	import { embedKickerClass } from './embed-surface.js';

	let {
		title,
		channel,
		tag,
		closes,
		titleClass,
	}: {
		title: string;
		channel: string;
		tag?: string;
		closes?: string;
		titleClass: string;
	} = $props();
</script>

<p class={embedKickerClass}>
	<span class="font-medium tracking-[0.04em] text-mention-accent uppercase">
		{tag ?? $t('design.chat.pollTag')}
	</span>
	<span aria-hidden="true">·</span>
	<span class="min-w-0 truncate">#{channel}</span>
</p>
{#if closes}
	<Card.Action class="flex items-center gap-1 text-xs leading-none text-muted-foreground tabular-nums">
		<Clock class="size-3" aria-hidden="true" />
		<span>{closes}</span>
	</Card.Action>
{/if}
<Card.Title class={titleClass}>{title}</Card.Title>

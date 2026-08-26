<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { t } from 'svelte-i18n';
	import { embedStripFrameClass } from './embed-surface.js';
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
		closes?: string;
		options: { label: string; votes: number }[];
	} = $props();

	const total = $derived(options.reduce((sum, option) => sum + option.votes, 0));
	const lead = $derived(
		options.reduce(
			(best, option) => (option.votes > best.votes ? option : best),
			options[0] ?? { label: '', votes: 0 },
		),
	);
	const leadPct = $derived(total === 0 ? 0 : Math.round((lead.votes / total) * 100));
</script>

<button
	type="button"
	class={embedStripFrameClass}
	aria-label={$t('design.chat.openPoll', { values: { channel, title } })}
>
	<Card.Header class="grid-cols-[minmax(0,1fr)_auto] gap-1">
		<PollEmbedHeading
			{title}
			{channel}
			{tag}
			{closes}
			titleClass="col-span-2 line-clamp-2 min-h-10 text-pretty"
		/>
	</Card.Header>

	<Card.Content class="flex min-h-0 flex-1 flex-col justify-end gap-2">
		<div class="flex h-5 min-w-0 items-baseline justify-between gap-2">
			<span class="min-w-0 truncate text-[13px] leading-5 text-secondary-foreground">
				{$t('design.chat.pollLead', { values: { label: lead.label } })}
			</span>
			<span class="shrink-0 text-[13px] leading-5 font-medium text-foreground tabular-nums">{leadPct}%</span>
		</div>
		<span class="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
			<span
				class="block h-full w-full origin-left rounded-full bg-primary/55"
				style={`transform: scaleX(${leadPct / 100})`}
			></span>
		</span>
	</Card.Content>

	<Card.Footer class="mt-auto border-border/80">
		<p class="m-0 min-w-0 truncate text-xs leading-snug text-muted-foreground">
			<span class="tabular-nums text-secondary-foreground">
				{$t('design.chat.voted', { values: { count: total } })}
			</span>
			<span aria-hidden="true"> · </span>
			<span>{$t('design.chat.openInChannel', { values: { channel } })}</span>
		</p>
	</Card.Footer>
</button>

<script lang="ts">
	import { t } from 'svelte-i18n';
	import { design } from '../../design-state.svelte.js';
	import * as Card from '$lib/components/ui/card/index.js';

	const cards = [
		{ key: 'membersOnline' as const, value: '4' },
		{ key: 'openProposals' as const, value: '2' },
		{ key: 'treasurySepolia' as const, value: '12.5 ETH' },
	];
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-foreground">
			{$t('design.dashboard.statusTitle')}
		</h1>
		<p class="text-sm text-pretty text-muted-foreground">
			{$t('design.dashboard.statusBody', { values: { squad: design.activeSquad?.name ?? '' } })}
		</p>
	</header>

	<div class="grid gap-3 sm:grid-cols-3">
		{#each cards as card (card.key)}
			<Card.Root class="rounded-lg px-4 py-3" size="sm">
				<div class="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
					{$t(`design.dashboard.${card.key}`)}
				</div>
				<div class="mt-1 text-[20px] font-semibold tabular-nums text-foreground">{card.value}</div>
			</Card.Root>
		{/each}
	</div>
</section>

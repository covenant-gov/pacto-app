<script lang="ts">
	import { t } from 'svelte-i18n';
	import { design } from '../../design-state.svelte.js';

	const cards = [
		{ key: 'membersOnline' as const, value: '4' },
		{ key: 'openProposals' as const, value: '2' },
		{ key: 'treasurySepolia' as const, value: '12.5 ETH' },
	];
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-[var(--text-primary)]">
			{$t('design.dashboard.statusTitle')}
		</h1>
		<p class="text-sm text-pretty text-[var(--text-muted)]">
			{$t('design.dashboard.statusBody', { values: { squad: design.activeSquad?.name ?? '' } })}
		</p>
	</header>

	<div class="grid gap-3 sm:grid-cols-3">
		{#each cards as card (card.key)}
			<div
				class="rounded-lg bg-[var(--bg-panel)] px-4 py-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]"
			>
				<div class="text-[11px] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
					{$t(`design.dashboard.${card.key}`)}
				</div>
				<div class="mt-1 text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">
					{card.value}
				</div>
			</div>
		{/each}
	</div>
</section>

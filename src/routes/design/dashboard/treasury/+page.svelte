<script lang="ts">
	import { t } from 'svelte-i18n';

	const balance = '12.50 ETH';
	const inbound = '+2.50 ETH';
	const outbound = '−0.12 ETH';
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-[var(--text-primary)]">
			{$t('design.dashboard.treasuryHeading')}
		</h1>
		<p class="text-sm text-pretty text-[var(--text-muted)]">
			{$t('design.dashboard.treasuryBody')}
		</p>
	</header>

	<div
		class="rounded-lg bg-[var(--bg-panel)] px-4 py-4 shadow-[0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]"
	>
		<div class="text-[11px] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
			{$t('design.dashboard.safeBalance')}
		</div>
		<div class="mt-1 text-[28px] font-semibold tabular-nums text-[var(--text-primary)]">{balance}</div>
		<div class="mt-3 flex flex-col gap-2 text-sm">
			<div class="flex justify-between gap-4">
				<span class="text-[var(--text-muted)]">{$t('design.dashboard.inbound7d')}</span>
				<span class="tabular-nums text-[var(--gov-success)]">{inbound}</span>
			</div>
			<div class="flex justify-between gap-4">
				<span class="text-[var(--text-muted)]">{$t('design.dashboard.outbound7d')}</span>
				<span class="tabular-nums text-[var(--text-secondary)]">{outbound}</span>
			</div>
		</div>
	</div>
</section>

<script lang="ts">
	import { t } from 'svelte-i18n';
	import * as Card from '$lib/components/ui/card/index.js';

	const balance = '12.50 ETH';
	const inbound = '+2.50 ETH';
	const outbound = '−0.12 ETH';
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-foreground">
			{$t('design.dashboard.treasuryHeading')}
		</h1>
		<p class="text-sm text-pretty text-muted-foreground">
			{$t('design.dashboard.treasuryBody')}
		</p>
	</header>

	<Card.Root class="rounded-lg px-4 py-4" size="sm">
		<div class="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
			{$t('design.dashboard.safeBalance')}
		</div>
		<div class="mt-1 text-[28px] font-semibold tabular-nums text-foreground">{balance}</div>
		<div class="mt-3 flex flex-col gap-2 text-sm">
			<div class="flex justify-between gap-4">
				<span class="text-muted-foreground">{$t('design.dashboard.inbound7d')}</span>
				<span class="tabular-nums text-gov-success">{inbound}</span>
			</div>
			<div class="flex justify-between gap-4">
				<span class="text-muted-foreground">{$t('design.dashboard.outbound7d')}</span>
				<span class="tabular-nums text-secondary-foreground">{outbound}</span>
			</div>
		</div>
	</Card.Root>
</section>

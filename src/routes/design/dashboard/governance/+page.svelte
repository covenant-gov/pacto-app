<script lang="ts">
	import Landmark from '@lucide/svelte/icons/landmark';
	import { t } from 'svelte-i18n';
	import * as Card from '$lib/components/ui/card/index.js';

	const stamp = {
		author: 'Pacto Gov',
		time: 'Today at 9:14 AM · Sepolia',
		body: 'Proposal #12 passed · Treasury +2.5 ETH',
	};
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-foreground">
			{$t('design.dashboard.governanceHeading')}
		</h1>
		<p class="text-sm text-pretty text-muted-foreground">
			{$t('design.dashboard.governanceBody')}
		</p>
	</header>

	<Card.Root class="flex-row gap-3 rounded-lg p-4" size="sm">
		<div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-gov-avatar text-gov-success">
			<Landmark class="size-5" />
		</div>
		<div class="flex min-w-0 flex-col gap-1">
			<div class="flex flex-wrap items-baseline gap-2">
				<span class="text-sm font-semibold text-foreground">{stamp.author}</span>
				<span class="text-xs text-muted-foreground tabular-nums">{stamp.time}</span>
			</div>
			<p class="text-sm text-pretty text-secondary-foreground">{stamp.body}</p>
		</div>
	</Card.Root>
</section>

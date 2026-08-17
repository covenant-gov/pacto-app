<script lang="ts">
	import Landmark from '@lucide/svelte/icons/landmark';
	import { t } from 'svelte-i18n';

	const stamp = {
		author: 'Pacto Gov',
		time: 'Today at 9:14 AM · Sepolia',
		body: 'Proposal #12 passed · Treasury +2.5 ETH',
	};
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-[var(--text-primary)]">
			{$t('design.dashboard.governanceHeading')}
		</h1>
		<p class="text-sm text-pretty text-[var(--text-muted)]">
			{$t('design.dashboard.governanceBody')}
		</p>
	</header>

	<article
		class="flex gap-3 rounded-lg bg-[var(--bg-panel)] p-4 shadow-[0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]"
	>
		<div
			class="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#152a2a] text-[var(--gov-success)]"
		>
			<Landmark class="size-5" />
		</div>
		<div class="flex min-w-0 flex-col gap-1">
			<div class="flex flex-wrap items-baseline gap-2">
				<span class="text-[14px] font-semibold text-[var(--text-primary)]">{stamp.author}</span>
				<span class="tabular-nums text-xs text-[var(--text-muted)]">{stamp.time}</span>
			</div>
			<p class="text-sm text-pretty text-[var(--text-secondary)]">
				{stamp.body}
			</p>
		</div>
	</article>
</section>

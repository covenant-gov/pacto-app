<script lang="ts">
	import { t } from 'svelte-i18n';
	import { members, type Hat } from '../../fixtures.js';

	const hatOrder: Hat[] = ['admin', 'quartermaster', 'crew'];
	const hatColor: Record<Hat, string> = {
		admin: 'var(--warning)',
		quartermaster: 'var(--union-steel, var(--text-secondary))',
		crew: 'var(--text-secondary)',
	};

	const byHat = $derived({
		admin: members.filter((member) => member.hat === 'admin'),
		quartermaster: members.filter((member) => member.hat === 'quartermaster'),
		crew: members.filter((member) => member.hat === 'crew'),
	});
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-[var(--text-primary)]">
			{$t('design.dashboard.rolesHeading')}
		</h1>
		<p class="text-sm text-pretty text-[var(--text-muted)]">
			{$t('design.dashboard.rolesBody')}
		</p>
	</header>

	{#each hatOrder as hat (hat)}
		{#if byHat[hat].length > 0}
			<div class="flex flex-col gap-2">
				<div
					class="text-[11px] font-medium tracking-[0.07em] uppercase text-[var(--text-muted)]"
					style={`color: ${hatColor[hat]};`}
				>
					{$t(`design.hats.${hat}`)}
					<span class="tabular-nums opacity-70">· {byHat[hat].length}</span>
				</div>
				<ul class="flex flex-col gap-1">
					{#each byHat[hat] as member (member.id)}
						<li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-primary)]">
							<span
								class="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold"
								style={`background-color: ${member.color};`}
							>
								{member.initials}
							</span>
							{member.name}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}
</section>

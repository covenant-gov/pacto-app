<script lang="ts">
	import { t } from 'svelte-i18n';
	import { members, type Hat } from '../../fixtures.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { cn } from '$lib/utils.js';

	const hatOrder: Hat[] = ['admin', 'quartermaster', 'crew'];
	const hatColor: Record<Hat, string> = {
		admin: 'text-warning',
		quartermaster: 'text-role-quartermaster',
		crew: 'text-secondary-foreground',
	};

	const byHat = $derived({
		admin: members.filter((member) => member.hat === 'admin'),
		quartermaster: members.filter((member) => member.hat === 'quartermaster'),
		crew: members.filter((member) => member.hat === 'crew'),
	});
</script>

<section class="flex flex-col gap-4 px-6 py-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-[22px] font-semibold tracking-[-0.01em] text-balance text-foreground">
			{$t('design.dashboard.rolesHeading')}
		</h1>
		<p class="text-sm text-pretty text-muted-foreground">
			{$t('design.dashboard.rolesBody')}
		</p>
	</header>

	{#each hatOrder as hat (hat)}
		{#if byHat[hat].length > 0}
			<div class="flex flex-col gap-2">
				<div class={cn('text-[11px] font-medium tracking-[0.07em] uppercase', hatColor[hat])}>
					{$t(`design.hats.${hat}`)}
					<span class="tabular-nums opacity-70">· {byHat[hat].length}</span>
				</div>
				<ul class="flex flex-col gap-1">
					{#each byHat[hat] as member (member.id)}
						<li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground">
							<Avatar.Root size="sm" class="size-7">
								<Avatar.Fallback
									class="identity-fill text-[11px] font-semibold"
									style={`--identity: ${member.color}`}
								>
									{member.initials}
								</Avatar.Fallback>
							</Avatar.Root>
							{member.name}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}
</section>

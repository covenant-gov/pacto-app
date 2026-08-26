<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { t } from 'svelte-i18n';
	import type { Hat, Member, PresenceStatus } from '../fixtures.js';
	import { PresenceAvatar } from '../../../components/shell';

	let { members }: { members: Member[] } = $props();

	const hatOrder: Hat[] = ['admin', 'quartermaster', 'crew'];
	const nameColorClass: Record<Hat, string> = {
		admin: 'text-warning',
		quartermaster: 'text-role-quartermaster',
		crew: 'text-foreground',
	};

	const groups = $derived(
		hatOrder
			.map((hat) => ({ hat, members: members.filter((member) => member.hat === hat) }))
			.filter((group) => group.members.length > 0),
	);

	function toPresence(status: PresenceStatus) {
		if (status === 'dnd') return 'busy';
		return status;
	}
</script>

<aside class="flex h-full w-full flex-col overflow-hidden bg-muted" aria-label={$t('design.members.region')}>
	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-4">
			{#if groups.length === 0}
				<p class="px-2 py-4 text-xs text-muted-foreground">{$t('design.members.empty')}</p>
			{:else}
				{#each groups as group (group.hat)}
					<section class="not-first:mt-4">
						<div class="px-2 pb-2 text-[11px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
							{$t(`design.hats.${group.hat}`)} — {group.members.length}
						</div>
						{#each group.members as member (member.id)}
							<div
								class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-accent"
							>
								<PresenceAvatar
									initials={member.initials}
									color={member.color}
									presence={toPresence(member.status)}
									size="sm"
									ringClass="border-muted"
								/>
								<span
									class={cn(
										'truncate text-[13.5px] font-medium tracking-[0.01em]',
										member.status === 'offline' ? 'text-muted-foreground' : nameColorClass[member.hat],
									)}
								>
									{member.name}
								</span>
							</div>
						{/each}
					</section>
				{/each}
			{/if}
	</div>
</aside>

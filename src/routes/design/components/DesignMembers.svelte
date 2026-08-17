<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { t } from 'svelte-i18n';
	import type { Hat, Member, PresenceStatus } from '../fixtures.js';

	let { members }: { members: Member[] } = $props();

	const hatOrder: Hat[] = ['admin', 'quartermaster', 'crew'];
	const nameColorClass: Record<Hat, string> = {
		admin: 'member-name--admin',
		quartermaster: 'member-name--qm',
		crew: 'member-name--crew',
	};
	const presenceDotClass: Record<PresenceStatus, string> = {
		online: 'bg-[var(--success)]',
		away: 'bg-[var(--warning)]',
		dnd: 'bg-[var(--danger)]',
		offline: 'bg-[var(--text-muted)]',
		invisible: 'bg-[var(--text-muted)]',
	};

	const groups = $derived(
		hatOrder
			.map((hat) => ({ hat, members: members.filter((member) => member.hat === hat) }))
			.filter((group) => group.members.length > 0),
	);
</script>

<aside class="h-full w-full overflow-y-auto bg-[var(--bg-panel)] px-2 py-3" aria-label={$t('design.members.region')}>
	{#if groups.length === 0}
		<p class="member-empty">{$t('design.members.empty')}</p>
	{:else}
		{#each groups as group (group.hat)}
			<div class="member-group">{$t(`design.hats.${group.hat}`)} — {group.members.length}</div>
			{#each group.members as member (member.id)}
				<div class="member-row">
					<div class="relative size-[30px] shrink-0">
						<div
							class="flex size-[30px] items-center justify-center rounded-full text-[11px] font-semibold text-[var(--text-primary)]"
							style={`background-color: ${member.color};`}
						>
							{member.initials}
						</div>
						<span
							class={cn(
								'absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-[var(--bg-panel)]',
								presenceDotClass[member.status],
							)}
						></span>
					</div>
					<span
						class={cn(
							'member-name',
							member.status === 'offline' ? 'member-name--offline' : nameColorClass[member.hat],
						)}
					>
						{member.name}
					</span>
				</div>
			{/each}
		{/each}
	{/if}
</aside>

<style>
	.member-empty {
		padding: 12px 8px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.member-group {
		padding: 20px 8px 4px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.member-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13.5px;
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	.member-name--admin {
		color: var(--warning);
	}

	.member-name--qm {
		color: #8babc8;
	}

	.member-name--crew {
		color: var(--text-primary);
	}

	.member-name--offline {
		color: var(--text-muted);
	}

	.member-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	@media (hover: hover) and (pointer: fine) {
		.member-row:hover {
			background: rgba(255, 255, 255, 0.04);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.member-row {
			transition: none;
		}
	}
</style>

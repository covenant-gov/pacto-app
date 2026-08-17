<script lang="ts">
	import type {
		MemberSidebarLabels,
		ShellMember,
		ShellPresence,
		ShellSelectCallback,
	} from '$lib/shell';

	interface Props {
		members: readonly ShellMember[];
		labels: MemberSidebarLabels;
		selectedMemberId?: string;
		onSelectMember?: ShellSelectCallback;
	}

	let { members, labels, selectedMemberId = '', onSelectMember }: Props = $props();

	const membersByRole = $derived.by(() => {
		const groups: Array<{ role: string; members: ShellMember[] }> = [];
		const indexByRole = new Map<string, number>();
		for (const member of members) {
			const existing = indexByRole.get(member.role);
			if (existing !== undefined) {
				groups[existing].members.push(member);
				continue;
			}
			indexByRole.set(member.role, groups.length);
			groups.push({ role: member.role, members: [member] });
		}
		return groups;
	});

	const presenceClass: Record<ShellPresence, string> = {
		online: 'presence-online',
		away: 'presence-away',
		busy: 'presence-busy',
		offline: 'presence-offline',
	};
</script>

<aside class="member-sidebar h-full min-h-0 bg-[var(--bg-panel)]" aria-label={labels.region}>
	<header>
		<h2>{labels.members}</h2>
		<span>{members.length}</span>
	</header>

	<div class="member-scroll">
		{#if members.length}
			{#each membersByRole as group (group.role)}
				<section aria-labelledby={`member-role-${group.role.replaceAll(' ', '-')}`}>
					<h3 id={`member-role-${group.role.replaceAll(' ', '-')}`}>{group.role}</h3>
					{#each group.members as member (member.id)}
						<button
							type="button"
							class:active={member.id === selectedMemberId}
							class="member-row"
							aria-label={labels.selectMember(member.name)}
							aria-pressed={member.id === selectedMemberId}
							onclick={() => onSelectMember?.(member.id)}
						>
							<span class="avatar-wrap">
								<span class="member-initials" aria-hidden="true">{member.initials}</span>
								<span
									class={`presence-dot ${presenceClass[member.presence]}`}
									aria-hidden="true"
								></span>
							</span>
							<span class="member-copy">
								<span class="member-name" title={member.name}>
									{member.name}
									{#if member.isCurrentUser}
										<span class="sr-only">({labels.currentUser})</span>
									{/if}
								</span>
								<span class="member-status">
									{labels.presence[member.presence]} · {member.status}
								</span>
							</span>
						</button>
					{/each}
				</section>
			{/each}
		{:else}
			<p class="empty-members" role="status">{labels.empty}</p>
		{/if}
	</div>
</aside>

<style>
	.member-sidebar {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.member-sidebar > header {
		display: flex;
		height: 48px;
		flex: none;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 12px;
	}

	.member-sidebar > header h2 {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.member-sidebar > header span {
		color: var(--text-muted);
		font-family: var(--font-mono-family);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
	}

	.member-scroll {
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 8px;
	}

	.member-scroll h3 {
		padding: 10px 6px 4px;
		color: var(--text-muted);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.member-row {
		appearance: none;
		display: flex;
		width: 100%;
		min-height: 44px;
		align-items: center;
		gap: 9px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		box-shadow: none;
		padding: 5px 6px;
		color: var(--text-secondary);
		text-align: left;
		touch-action: manipulation;
	}

	.member-row:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	.member-row.active {
		background: var(--bg-hover);
	}

	.avatar-wrap {
		position: relative;
		flex: none;
	}

	.member-initials {
		display: inline-flex;
		width: 28px;
		height: 28px;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--bg-elevated);
		color: var(--text-primary);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.presence-dot {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 9px;
		height: 9px;
		border: 2px solid var(--bg-panel);
		border-radius: 50%;
	}

	.presence-online {
		background: var(--success);
	}

	.presence-away {
		background: var(--warning);
	}

	.presence-busy {
		background: var(--danger);
	}

	.presence-offline {
		background: var(--text-muted);
	}

	.member-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.member-name,
	.member-status {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.member-name {
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.member-status {
		color: var(--text-muted);
		font-size: 0.625rem;
	}

	.empty-members {
		padding: 12px 6px;
		color: var(--text-muted);
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	@media (hover: hover) and (pointer: fine) {
		.member-row:hover {
			background: rgba(255, 255, 255, 0.04);
		}
	}
</style>

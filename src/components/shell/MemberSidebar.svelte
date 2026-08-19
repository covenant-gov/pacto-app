<script lang="ts">
	import type {
		MemberSidebarLabels,
		ShellMember,
		ShellSelectCallback,
	} from '$lib/shell';
	import PresenceAvatar from './PresenceAvatar.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

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
</script>

<aside class="flex h-full min-h-0 flex-col overflow-hidden bg-muted" aria-label={labels.region}>
	<header class="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
		<h2 class="text-xs font-bold tracking-[0.06em] uppercase">{labels.members}</h2>
		<span class="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{members.length}</span>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
		{#if members.length}
			{#each membersByRole as group (group.role)}
				<section aria-labelledby={`member-role-${group.role.replaceAll(' ', '-')}`}>
					<h3
						id={`member-role-${group.role.replaceAll(' ', '-')}`}
						class="px-1.5 pt-2.5 pb-1 text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase"
					>
						{group.role}
					</h3>
					{#each group.members as member (member.id)}
						<Button
							variant="ghost"
							class={cn(
								'h-auto w-full min-h-11 justify-start gap-2 rounded-md px-1.5 py-1 text-left font-normal text-secondary-foreground',
								member.id === selectedMemberId && 'bg-accent',
							)}
							aria-label={labels.selectMember(member.name)}
							aria-pressed={member.id === selectedMemberId}
							onclick={() => onSelectMember?.(member.id)}
						>
							<PresenceAvatar
								initials={member.initials}
								color="var(--bg-elevated)"
								presence={member.presence}
								size="sm"
								ringClass="border-muted"
							/>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-[0.8125rem] font-semibold text-foreground" title={member.name}>
									{member.name}
									{#if member.isCurrentUser}
										<span class="sr-only">({labels.currentUser})</span>
									{/if}
								</span>
								<span class="truncate text-[0.625rem] text-muted-foreground">
									{labels.presence[member.presence]} · {member.status}
								</span>
							</span>
						</Button>
					{/each}
				</section>
			{/each}
		{:else}
			<p class="px-1.5 py-3 text-[0.8125rem] leading-snug text-muted-foreground" role="status">{labels.empty}</p>
		{/if}
	</div>
</aside>

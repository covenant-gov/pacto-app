<script lang="ts">
	import Gavel from '@lucide/svelte/icons/gavel';
	import Hash from '@lucide/svelte/icons/hash';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cn } from '$lib/utils.js';
	import type {
		NavRailLabels,
		ShellLens,
		ShellSelectCallback,
		ShellSquad,
	} from '$lib/shell';
	import RailTile from './RailTile.svelte';

	interface Props {
		lenses: readonly ShellLens[];
		squads: readonly ShellSquad[];
		activeLensId: string;
		activeSquadId: string;
		labels: NavRailLabels;
		onSelectLens: ShellSelectCallback;
		onSelectSquad: ShellSelectCallback;
	}

	let {
		lenses,
		squads,
		activeLensId,
		activeSquadId,
		labels,
		onSelectLens,
		onSelectSquad,
	}: Props = $props();
</script>

<nav
	class="flex h-full min-h-0 flex-col items-center overflow-hidden bg-secondary px-2 py-2 max-[720px]:px-1.5"
	aria-label={labels.navigation}
>
	<div class="grid gap-1.5">
		{#each lenses as lens (lens.id)}
			<RailTile
				variant="surface"
				active={lens.id === activeLensId}
				class={cn(
					'size-11 rounded-xl bg-muted text-muted-foreground',
					lens.id === activeLensId && 'rounded-lg bg-primary text-primary-foreground after:hidden',
				)}
				aria-label={labels.selectLens(lens.label)}
				aria-current={lens.id === activeLensId ? 'page' : undefined}
				onclick={() => onSelectLens(lens.id)}
			>
				{#if lens.kind === 'dashboard'}
					<LayoutDashboard class="size-[18px]" aria-hidden="true" />
				{:else if lens.kind === 'governance'}
					<Gavel class="size-[18px]" aria-hidden="true" />
				{:else if lens.kind === 'chat'}
					<MessageCircle class="size-[18px]" aria-hidden="true" />
				{:else}
					<Hash class="size-[18px]" aria-hidden="true" />
				{/if}
			</RailTile>
		{/each}
	</div>

	<Separator class="my-2 w-8" />

	<div class="grid min-h-0 gap-2 overflow-y-auto overscroll-contain px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
		{#each squads as squad (squad.id)}
			<RailTile
				variant="surface"
				active={squad.id === activeSquadId}
				class={cn(
					'size-11 rounded-xl bg-muted text-muted-foreground',
					squad.id === activeSquadId && 'rounded-lg bg-primary text-primary-foreground after:hidden',
				)}
				aria-label={labels.selectSquad(squad.name)}
				aria-current={squad.id === activeSquadId ? 'page' : undefined}
				title={squad.name}
				onclick={() => onSelectSquad(squad.id)}
			>
				<span class="max-w-9 truncate text-xs font-bold tracking-[0.03em]" aria-hidden="true">
					{squad.initials}
				</span>
				{#if squad.unreadCount}
					<Badge
						variant="notif"
						class="absolute -right-1 -bottom-1 z-10 ring-2 ring-secondary"
						aria-label={labels.unreadCount(squad.unreadCount)}
					>
						{squad.unreadCount > 99 ? '99+' : squad.unreadCount}
					</Badge>
				{/if}
			</RailTile>
		{/each}
	</div>
</nav>

<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { cn } from '$lib/utils.js';

	type Presence = 'online' | 'away' | 'busy' | 'dnd' | 'offline' | 'invisible';

	let {
		initials,
		color,
		presence,
		size = 'default',
		ringClass = 'ring-background',
	}: {
		initials: string;
		color: string;
		presence: Presence;
		size?: 'default' | 'sm' | 'lg';
		ringClass?: string;
	} = $props();

	const presenceClass: Record<Presence, string> = {
		online: 'bg-gov-success',
		away: 'bg-warning',
		busy: 'bg-destructive',
		dnd: 'bg-destructive',
		offline: 'bg-muted-foreground',
		invisible: 'bg-muted-foreground',
	};
</script>

<Avatar.Root {size} class="relative">
	<Avatar.Fallback class="identity-fill font-semibold" style={`--identity: ${color}`}>
		{initials}
	</Avatar.Fallback>
	<span
		class={cn(
			'absolute -right-px -bottom-px z-10 size-2.5 rounded-full border-2',
			ringClass,
			presenceClass[presence],
		)}
		aria-hidden="true"
	></span>
</Avatar.Root>

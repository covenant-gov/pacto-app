<script lang="ts">
	import Landmark from '@lucide/svelte/icons/landmark';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	let {
		kind,
		role,
		author,
		initials,
		color,
	}: {
		kind: 'text' | 'gov' | 'sys';
		role?: 'admin' | 'qm' | 'cm';
		author: string;
		initials: string;
		color: string;
	} = $props();
</script>

{#if kind === 'gov'}
	<div
		class="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-gov-avatar text-gov-success"
	>
		<Landmark class="size-[18px]" />
	</div>
{:else if role === 'cm' || author === 'Nova'}
	<div class="relative size-[38px] shrink-0" aria-hidden="true">
		<span
			class="absolute inset-0 bg-linear-to-br from-[#f2f5f8] via-[#9aa8b8] to-[#6b7c8f] [clip-path:polygon(50%_0%,94%_25%,94%_75%,50%_100%,6%_75%,6%_25%)]"
		></span>
		<span
			class="identity-fill absolute inset-[2px] flex items-center justify-center text-[13px] font-semibold [clip-path:polygon(50%_0%,94%_25%,94%_75%,50%_100%,6%_75%,6%_25%)]"
			style={`--identity: ${color}`}
		>
			{initials}
		</span>
	</div>
{:else}
	<Avatar.Root class="size-[38px]">
		<Avatar.Fallback class="identity-fill text-[13px] font-semibold" style={`--identity: ${color}`}>
			{initials}
		</Avatar.Fallback>
	</Avatar.Root>
{/if}

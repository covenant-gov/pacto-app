<script lang="ts">
	import Badge from './badge.svelte';
	import type { BadgeVariant } from './badge.svelte';

	let {
		variant = 'default',
		label = '3',
	}: {
		variant?: BadgeVariant;
		label?: string;
	} = $props();
</script>

<Badge {variant}>{label}</Badge>

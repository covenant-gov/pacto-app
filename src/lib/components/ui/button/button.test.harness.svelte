<script lang="ts">
	import Button from './button.svelte';

	let {
		href,
		disabled = false,
		label = 'Action',
	}: {
		href?: string;
		disabled?: boolean;
		label?: string;
	} = $props();
</script>

<Button {href} {disabled}>{label}</Button>

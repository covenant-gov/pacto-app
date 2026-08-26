<script lang="ts">
	import Button from './button.svelte';
	import type { ButtonSize, ButtonVariant } from './button.svelte';

	let {
		href,
		disabled = false,
		label = 'Action',
		variant,
		size,
	}: {
		href?: string;
		disabled?: boolean;
		label?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();
</script>

<Button {href} {disabled} {variant} {size}>{label}</Button>

<script lang="ts">
	import AppShell from './AppShell.svelte';
	import type { AppShellLabels } from '$lib/shell';

	interface Props {
		labels: AppShellLabels;
		regionNames: {
			rail: string;
			sidebar: string;
			main: string;
			aside: string;
		};
	}

	let { labels, regionNames }: Props = $props();
</script>

<AppShell {labels}>
	{#snippet rail()}
		<div>{regionNames.rail}</div>
	{/snippet}
	{#snippet sidebar()}
		<div>{regionNames.sidebar}</div>
	{/snippet}
	{#snippet main()}
		<div>{regionNames.main}</div>
	{/snippet}
	{#snippet aside()}
		<div>{regionNames.aside}</div>
	{/snippet}
</AppShell>

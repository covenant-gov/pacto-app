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
		asideCollapsed?: boolean;
	}

	let { labels, regionNames, asideCollapsed = false }: Props = $props();
</script>

<AppShell {labels} bind:asideCollapsed>
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

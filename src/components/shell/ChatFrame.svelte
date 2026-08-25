<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Hash from '@lucide/svelte/icons/hash';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Lock from '@lucide/svelte/icons/lock';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type {
		ChatFrameLabels,
		ShellChannelKind,
		ShellPreviewState,
		ShellRetryCallback,
	} from '$lib/shell';

	interface Props {
		title: string;
		subtitle?: string;
		kind?: ShellChannelKind;
		state?: ShellPreviewState;
		labels: ChatFrameLabels;
		children: Snippet;
		actions?: Snippet;
		onRetry?: ShellRetryCallback;
	}

	let {
		title,
		subtitle,
		kind = 'text',
		state = 'default',
		labels,
		children,
		actions,
		onRetry,
	}: Props = $props();
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden bg-muted" aria-label={labels.region}>
	<header class="flex h-12 shrink-0 items-center gap-2 bg-muted px-3.5">
		<div
			class="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted text-secondary-foreground"
			aria-hidden="true"
		>
			{#if kind === 'private'}
				<Lock class="size-4" />
			{:else if kind === 'announcement'}
				<Megaphone class="size-4" />
			{:else}
				<Hash class="size-4" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground" {title}>{title}</h1>
			{#if subtitle}
				<p class="truncate text-[0.6875rem] leading-tight text-muted-foreground" title={subtitle}>{subtitle}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 items-center gap-1">{@render actions()}</div>
		{/if}
	</header>

	<div class="min-h-0 flex-1 overflow-hidden rounded-tl-lg bg-background">
		{#if state === 'loading'}
			<div class="h-full overflow-hidden px-[18px] py-[22px]" role="status" aria-busy="true">
				<span class="sr-only">{labels.loading}</span>
				{#each Array(7) as _, index (index)}
					<div class="mb-5 flex gap-2.5" aria-hidden="true">
						<Skeleton class="size-[34px] shrink-0 rounded-full" />
						<div class="w-[min(38rem,78%)]">
							<Skeleton class="my-1.5 h-2.5 rounded" style={`width: calc(28% + ${index} * 2%)`} />
							<Skeleton class="my-1.5 h-2 w-full rounded" />
							<Skeleton class="my-1.5 h-2 w-[62%] rounded" />
						</div>
					</div>
				{/each}
			</div>
		{:else if state === 'empty'}
			<div class="grid h-full place-content-center justify-items-center px-6 text-center text-muted-foreground">
				<Inbox class="size-7" aria-hidden="true" />
				<h2 class="mt-2.5 text-base text-foreground">{labels.emptyTitle}</h2>
				<p class="mt-1 max-w-[30rem] text-[0.8125rem] leading-normal">{labels.emptyBody}</p>
			</div>
		{:else if state === 'error'}
			<div class="grid h-full place-content-center justify-items-center px-6 text-center text-muted-foreground" role="alert">
				<CircleAlert class="size-7 text-destructive" aria-hidden="true" />
				<h2 class="mt-2.5 text-base text-foreground">{labels.errorTitle}</h2>
				<p class="mt-1 max-w-[30rem] text-[0.8125rem] leading-normal">{labels.errorBody}</p>
				{#if onRetry}
					<Button variant="outline" size="sm" class="mt-3.5" onclick={onRetry}>
						<RotateCcw class="size-3.5" aria-hidden="true" />
						{labels.retry}
					</Button>
				{/if}
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
</section>

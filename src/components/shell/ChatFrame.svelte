<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Hash from '@lucide/svelte/icons/hash';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Lock from '@lucide/svelte/icons/lock';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import type { Snippet } from 'svelte';
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

<section class="chat-frame h-full min-h-0" aria-label={labels.region}>
	<header class="chat-header">
		<div class="channel-mark" aria-hidden="true">
			{#if kind === 'private'}
				<Lock class="size-4" />
			{:else if kind === 'announcement'}
				<Megaphone class="size-4" />
			{:else}
				<Hash class="size-4" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<h1 title={title}>{title}</h1>
			{#if subtitle}
				<p title={subtitle}>{subtitle}</p>
			{/if}
		</div>
		{#if actions}
			<div class="chat-actions">{@render actions()}</div>
		{/if}
	</header>

	<div class="chat-body min-h-0">
		{#if state === 'loading'}
			<div class="loading-state" role="status" aria-busy="true">
				<span class="sr-only">{labels.loading}</span>
				{#each Array(7) as _, index (index)}
					<div class="message-skeleton" aria-hidden="true">
						<div class="skeleton-avatar"></div>
						<div class="skeleton-lines">
							<div class="skeleton-line skeleton-name" style={`--skeleton-index: ${index}`}></div>
							<div class="skeleton-line"></div>
							<div class="skeleton-line skeleton-short"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if state === 'empty'}
			<div class="content-state">
				<Inbox class="size-7" aria-hidden="true" />
				<h2>{labels.emptyTitle}</h2>
				<p>{labels.emptyBody}</p>
			</div>
		{:else if state === 'error'}
			<div class="content-state" role="alert">
				<CircleAlert class="size-7 text-[var(--danger)]" aria-hidden="true" />
				<h2>{labels.errorTitle}</h2>
				<p>{labels.errorBody}</p>
				{#if onRetry}
					<button type="button" class="retry-button" onclick={onRetry}>
						<RotateCcw class="size-3.5" aria-hidden="true" />
						{labels.retry}
					</button>
				{/if}
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
</section>

<style>
	.chat-frame {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-page);
	}

	.chat-header {
		display: flex;
		height: 48px;
		flex: none;
		align-items: center;
		gap: 9px;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 14px;
		background: color-mix(in srgb, var(--bg-page) 94%, var(--bg-elevated));
	}

	.channel-mark {
		display: grid;
		width: 28px;
		height: 28px;
		flex: none;
		place-items: center;
		border: 1px solid var(--border-subtle);
		border-radius: 7px;
		background: var(--bg-panel);
		color: var(--text-secondary);
	}

	.chat-header h1 {
		overflow: hidden;
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-header p {
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.6875rem;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 4px;
	}

	.chat-body {
		flex: 1;
		overflow: hidden;
	}

	.loading-state {
		height: 100%;
		overflow: hidden;
		padding: 22px 18px;
	}

	.message-skeleton {
		display: flex;
		gap: 10px;
		margin-bottom: 20px;
	}

	.skeleton-avatar,
	.skeleton-line {
		background: var(--bg-hover);
		animation: skeleton-pulse 1.5s ease-in-out infinite alternate;
	}

	.skeleton-avatar {
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 50%;
	}

	.skeleton-lines {
		width: min(38rem, 78%);
	}

	.skeleton-line {
		width: 100%;
		height: 8px;
		margin: 7px 0;
		border-radius: 4px;
	}

	.skeleton-name {
		width: calc(28% + var(--skeleton-index) * 2%);
		height: 10px;
	}

	.skeleton-short {
		width: 62%;
	}

	.content-state {
		display: grid;
		height: 100%;
		place-content: center;
		justify-items: center;
		padding: 24px;
		color: var(--text-muted);
		text-align: center;
	}

	.content-state h2 {
		margin-top: 10px;
		color: var(--text-primary);
		font-size: 1rem;
	}

	.content-state p {
		max-width: 30rem;
		margin-top: 5px;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.retry-button {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		gap: 6px;
		margin-top: 14px;
		border: 1px solid var(--border-subtle);
		border-radius: 7px;
		padding: 0 10px;
		background: var(--bg-elevated);
		color: var(--text-primary);
		font-size: 0.75rem;
		font-weight: 600;
		touch-action: manipulation;
	}

	.retry-button:focus-visible {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.retry-button:hover {
			background: var(--bg-hover);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-avatar,
		.skeleton-line {
			animation: none;
		}
	}

	@keyframes skeleton-pulse {
		from {
			opacity: 0.45;
		}
		to {
			opacity: 0.9;
		}
	}
</style>

<script lang="ts">
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Hash from '@lucide/svelte/icons/hash';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pin from '@lucide/svelte/icons/pin';
	import { t } from 'svelte-i18n';
	import { AsideToggleButton } from '../../../components/shell';
	import ChatComposer from '../../../components/channel/ChatComposer.svelte';
	import type { Message } from '../fixtures.js';
	import ChatDitherDock from './ChatDitherDock.svelte';
	import ChatMessage from './ChatMessage.svelte';

	let {
		channelId,
		channelName,
		channelCategory = 'channels' as 'squad' | 'channels',
		messages,
		announcementOnly = false,
		membersCollapsed = false,
		memberFaces = [],
		onSend,
		onToggleMembers,
	}: {
		channelId: string;
		channelName: string;
		channelCategory?: 'squad' | 'channels';
		messages: Message[];
		announcementOnly?: boolean;
		membersCollapsed?: boolean;
		memberFaces?: readonly { id?: string; initials: string; color: string }[];
		onSend: (text: string) => void;
		onToggleMembers?: () => void;
	} = $props();

	let viewportEl = $state<HTMLElement | null>(null);
	let awayFromLatest = $state(false);

	function measureAway(): void {
		const el = viewportEl;
		if (!el) return;
		awayFromLatest = el.scrollHeight - el.scrollTop - el.clientHeight > 96;
	}

	function jumpToLatest(): void {
		viewportEl?.scrollTo({ top: viewportEl.scrollHeight, behavior: 'smooth' });
	}

	$effect(() => {
		const el = viewportEl;
		if (!el) return;
		measureAway();
		el.addEventListener('scroll', measureAway, { passive: true });
		return () => el.removeEventListener('scroll', measureAway);
	});

	$effect(() => {
		void channelId;
		awayFromLatest = false;
	});

	$effect(() => {
		const count = messages.length;
		const el = viewportEl;
		if (!el || awayFromLatest) return;
		void count;
		void channelId;
		queueMicrotask(() => {
			el.scrollTop = el.scrollHeight;
		});
	});
</script>

<div class="flex h-full min-w-0 flex-1 flex-col bg-muted">
	<div class="flex h-12 shrink-0 items-center gap-2 bg-muted px-4">
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<span class="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
				{#if announcementOnly}
					<Megaphone class="size-4" />
				{:else if channelCategory === 'squad'}
					<Pin class="size-4" />
				{:else}
					<Hash class="size-4" />
				{/if}
			</span>
			<h1 class="m-0 truncate text-[15px] leading-5 font-semibold tracking-[0.01em] text-foreground">
				{channelName}
			</h1>
			{#if announcementOnly}
				<span class="shrink-0 text-xs leading-5 text-muted-foreground">{$t('design.chat.broadcastOnly')}</span>
			{/if}
		</div>
		{#if announcementOnly}
			<Button variant="outline" size="sm" class="h-7 px-2.5 text-xs">{$t('design.chat.follow')}</Button>
		{/if}
		{#if onToggleMembers}
			<AsideToggleButton
				collapsed={membersCollapsed}
				faces={memberFaces}
				openLabel={$t('design.shell.openMembers')}
				closeLabel={$t('design.shell.closeMembers')}
				onToggle={onToggleMembers}
			/>
		{/if}
	</div>

	<div class="shell-dither-seam relative min-h-0 flex-1 overflow-hidden rounded-tl-lg bg-background">
		<ScrollArea.Root class="h-full" bind:viewportRef={viewportEl}>
			<div class="flex flex-col gap-6 px-5 pt-5 pb-48">
				{#each messages as message (message.id)}
					<ChatMessage {message} {channelId} {announcementOnly} />
				{/each}
			</div>
		</ScrollArea.Root>

		<ChatDitherDock {awayFromLatest} onJump={jumpToLatest}>
			{#if announcementOnly}
				<p
					class="mx-4 px-1 py-3 text-center text-[15px] leading-6 tracking-sm text-pretty text-muted-foreground [text-shadow:0_1px_12px_var(--background)]"
				>
					{$t('design.chat.publishOnly')}
				</p>
			{:else}
				<ChatComposer {channelName} {onSend} />
			{/if}
		</ChatDitherDock>
	</div>
</div>

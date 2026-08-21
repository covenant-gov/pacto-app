<script lang="ts">
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Hash from '@lucide/svelte/icons/hash';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pin from '@lucide/svelte/icons/pin';
	import { t } from 'svelte-i18n';
	import AsideToggleButton from '../../../components/shell/AsideToggleButton.svelte';
	import ChatComposer from '../../../components/channel/ChatComposer.svelte';
	import type { Message } from '../fixtures.js';
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

	<div class="shell-dither-seam flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-lg bg-background">
		<ScrollArea.Root class="min-h-0 flex-1">
			<div class="flex flex-col gap-6 px-5 py-5">
				{#each messages as message (message.id)}
					<ChatMessage {message} {channelId} {announcementOnly} />
				{/each}
			</div>
		</ScrollArea.Root>

		{#if announcementOnly}
			<div
				class="mx-4 mb-4 flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground"
			>
				{$t('design.chat.publishOnly')}
			</div>
		{:else}
			<ChatComposer {channelName} {onSend} />
		{/if}
	</div>
</div>

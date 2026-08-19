<script lang="ts">
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Hash from '@lucide/svelte/icons/hash';
	import Landmark from '@lucide/svelte/icons/landmark';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pin from '@lucide/svelte/icons/pin';
	import { t } from 'svelte-i18n';
	import AsideToggleButton from '../../../components/shell/AsideToggleButton.svelte';
	import ChatComposer from '../../../components/channel/ChatComposer.svelte';
	import ChatRichText from '../../../components/channel/ChatRichText.svelte';
	import MessageAuthorAvatar from '../../../components/channel/MessageAuthorAvatar.svelte';
	import PollEmbedCard from '../../../components/channel/PollEmbedCard.svelte';
	import VoteEmbedCard from '../../../components/channel/VoteEmbedCard.svelte';
	import { cn } from '$lib/utils.js';
	import type { Message } from '../fixtures.js';
	import { proposalTitle } from '../fixtures.js';

	let {
		channelName,
		channelCategory = 'channels' as 'squad' | 'channels',
		messages,
		announcementOnly = false,
		membersCollapsed = false,
		onSend,
		onToggleMembers,
	}: {
		channelName: string;
		channelCategory?: 'squad' | 'channels';
		messages: Message[];
		announcementOnly?: boolean;
		membersCollapsed?: boolean;
		onSend: (text: string) => void;
		onToggleMembers?: () => void;
	} = $props();

	const pollsChannel = '#polls';
	const governanceChannel = '#governance';

	function authorClass(role?: Message['role']): string {
		if (role === 'admin') return 'text-warning';
		if (role === 'qm') return 'text-role-quartermaster';
		if (role === 'cm') return 'text-role-community-manager';
		return 'text-foreground';
	}
</script>

<div class="flex h-full min-w-0 flex-1 flex-col bg-muted">
	<div class="flex h-12 shrink-0 items-center gap-2 bg-muted px-4">
		{#if announcementOnly}
			<Megaphone class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
		{:else if channelCategory === 'squad'}
			<Pin class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
		{:else}
			<Hash class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
		{/if}
		<span class="text-[15px] leading-none font-semibold tracking-[0.01em] text-foreground">{channelName}</span>
		{#if announcementOnly}
			<span class="text-xs leading-none text-muted-foreground">{$t('design.chat.broadcastOnly')}</span>
			<Button variant="outline" size="sm" class="ml-auto h-7 px-2.5 text-xs">{$t('design.chat.follow')}</Button>
		{/if}
		{#if onToggleMembers}
			<AsideToggleButton
				class={announcementOnly ? '' : 'ml-auto'}
				collapsed={membersCollapsed}
				openLabel={$t('design.shell.openMembers')}
				closeLabel={$t('design.shell.closeMembers')}
				onToggle={onToggleMembers}
			/>
		{/if}
	</div>

	{#if announcementOnly}
		<div class="flex shrink-0 items-center gap-2.5 bg-muted px-4 py-2.5 text-xs leading-[1.4] text-muted-foreground">
			<Megaphone class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
			<p class="m-0 min-w-0 text-pretty">
				{$t('design.chat.announceLead')}
				<span class="inline-flex items-center rounded-sm bg-accent/90 px-1.5 py-px font-medium text-foreground">
					{pollsChannel}
				</span>
				{$t('design.chat.announceMid')}
				<span class="inline-flex items-center rounded-sm bg-accent/90 px-1.5 py-px font-medium text-foreground">
					{governanceChannel}
				</span>
			</p>
		</div>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-lg bg-background">
		<ScrollArea.Root class="min-h-0 flex-1">
			<div class="flex flex-col gap-4 px-4 py-4">
				{#each messages as message (message.id)}
					<div class="flex items-start gap-3">
						<MessageAuthorAvatar
							kind={message.kind}
							role={message.role}
							author={message.author}
							initials={message.initials}
							color={message.color}
						/>
						<div class="flex min-w-0 flex-1 flex-col gap-1">
							<div class="flex min-h-5 flex-wrap items-center gap-2">
								<span class={cn('text-sm leading-none font-medium tracking-[0.01em]', authorClass(message.role))}>
									{message.author}
								</span>
								{#if message.role === 'cm'}
									<Badge variant="bot">{$t('design.chat.bot')}</Badge>
								{/if}
								<span class="text-[11px] leading-none text-muted-foreground tabular-nums">
									{message.time}
								</span>
								{#if message.network}
									<span class="text-[11px] leading-none text-muted-foreground" aria-hidden="true">·</span>
									<span class="text-[11px] leading-none text-muted-foreground tabular-nums">
										{message.network}
									</span>
								{/if}
								{#if announcementOnly}
									<span class="text-[11px] leading-none text-muted-foreground opacity-70">
										{$t('design.chat.published')}
									</span>
								{/if}
							</div>
							{#if message.kind === 'gov'}
								<div class="flex flex-wrap items-baseline gap-1.5 text-sm leading-[1.45] font-medium text-gov-success">
									<Landmark class="relative top-px size-3.5 shrink-0" />
									<span class="min-w-0 text-pretty">
										<ChatRichText text={message.text} proposalTitleFor={proposalTitle} />
									</span>
								</div>
							{:else}
								<p class="m-0 text-sm leading-[1.45] text-pretty text-secondary-foreground">
									<ChatRichText text={message.text} proposalTitleFor={proposalTitle} />
								</p>
							{/if}

							{#if message.embed?.kind === 'poll'}
								<PollEmbedCard
									title={message.embed.title}
									channel={message.embed.channel}
									tag={message.embed.tag}
									closes={message.embed.closes}
									options={message.embed.options}
									{announcementOnly}
								/>
							{:else if message.embed?.kind === 'vote'}
								<VoteEmbedCard
									title={message.embed.title}
									detail={message.embed.detail}
									amount={message.embed.amount}
									quorum={message.embed.quorum}
									tag={message.embed.tag}
									proposalId={message.embed.proposalId}
									closes={message.embed.closes}
									forPct={message.embed.forPct}
									againstPct={message.embed.againstPct}
									{announcementOnly}
								/>
							{/if}
						</div>
					</div>
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

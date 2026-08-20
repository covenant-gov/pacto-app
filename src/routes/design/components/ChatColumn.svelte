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

	function authorClass(role?: Message['role']): string {
		if (role === 'admin') return 'text-warning';
		if (role === 'qm') return 'text-role-quartermaster';
		if (role === 'cm') return 'text-role-community-manager';
		return 'text-foreground';
	}
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
				openLabel={$t('design.shell.openMembers')}
				closeLabel={$t('design.shell.closeMembers')}
				onToggle={onToggleMembers}
			/>
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-lg bg-background">
		<ScrollArea.Root class="min-h-0 flex-1">
			<div class="flex flex-col gap-5 px-5 py-5">
				{#each messages as message (message.id)}
					<div class="flex items-start gap-3.5">
						<MessageAuthorAvatar
							kind={message.kind}
							role={message.role}
							author={message.author}
							initials={message.initials}
							color={message.color}
						/>
						<div class="flex min-w-0 flex-1 flex-col gap-2.5">
							<div class="flex flex-col gap-1">
								<div class="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
									<span class={cn('text-sm leading-none font-semibold tracking-[0.01em]', authorClass(message.role))}>
										{message.author}
									</span>
									{#if message.role === 'cm'}
										<Badge variant="bot">{$t('design.chat.bot')}</Badge>
									{/if}
									<span class="text-xs leading-none text-muted-foreground tabular-nums">
										{message.time}
									</span>
									{#if message.network}
										<span class="text-xs leading-none text-muted-foreground" aria-hidden="true">·</span>
										<span class="text-xs leading-none text-muted-foreground tabular-nums">
											{message.network}
										</span>
									{/if}
									{#if announcementOnly}
										<span class="text-xs leading-none text-muted-foreground">
											{$t('design.chat.published')}
										</span>
									{/if}
								</div>
								{#if message.kind === 'gov'}
									<div class="flex flex-wrap items-baseline gap-1.5 text-[15px] leading-relaxed font-medium text-gov-success">
										<Landmark class="relative top-px size-3.5 shrink-0" />
										<span class="min-w-0 text-pretty">
											<ChatRichText text={message.text} proposalTitleFor={proposalTitle} />
										</span>
									</div>
								{:else}
									<p class="m-0 text-[15px] leading-relaxed text-pretty text-secondary-foreground">
										<ChatRichText text={message.text} proposalTitleFor={proposalTitle} />
									</p>
								{/if}
							</div>

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
									quorumNeeded={message.embed.quorumNeeded}
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

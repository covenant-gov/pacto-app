<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import Landmark from '@lucide/svelte/icons/landmark';
	import { t } from 'svelte-i18n';
	import ChatRichText from '../../../components/channel/ChatRichText.svelte';
	import MessageAuthorAvatar from '../../../components/channel/MessageAuthorAvatar.svelte';
	import PollEmbedCard from '../../../components/channel/PollEmbedCard.svelte';
	import PollEmbedStrip from '../../../components/channel/PollEmbedStrip.svelte';
	import VoteEmbedCard from '../../../components/channel/VoteEmbedCard.svelte';
	import VoteEmbedStrip from '../../../components/channel/VoteEmbedStrip.svelte';
	import { cn } from '$lib/utils.js';
	import { design } from '../design-state.svelte.js';
	import { ditherMaskStyle } from '../dither.js';
	import type { Message } from '../fixtures.js';
	import { pollTitle, proposalTitle } from '../fixtures.js';

	let {
		message,
		channelId,
		announcementOnly = false,
	}: {
		message: Message;
		channelId: string;
		announcementOnly?: boolean;
	} = $props();

	function authorClass(role?: Message['role']): string {
		if (role === 'admin') return 'text-warning';
		if (role === 'qm') return 'text-role-quartermaster';
		if (role === 'cm') return 'text-role-community-manager';
		return 'text-foreground';
	}
</script>

{#if message.kind === 'sys'}
	<div class="shell-sys-notice px-4 py-3">
		<div
			class="shell-sys-notice-wash"
			style={ditherMaskStyle(design.ditherPattern)}
			aria-hidden="true"
		></div>
		<div class="shell-sys-notice-fade" aria-hidden="true"></div>
		<p class="relative z-10 m-0 text-center text-xs leading-5 font-medium tracking-[0.04em] text-pretty text-muted-foreground">
			<span class="text-foreground/80 uppercase">{$t('design.chat.systemLabel')}</span>
			<span aria-hidden="true"> · </span>
			{message.text}
		</p>
	</div>
{:else}
<div class="flex items-start gap-3">
	<MessageAuthorAvatar
		kind={message.kind}
		role={message.role}
		author={message.author}
		initials={message.initials}
		color={message.color}
	/>
	<div class="flex min-w-0 flex-1 flex-col gap-2.5">
		<div class="flex flex-col gap-0.5">
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span class={cn('text-[15px] leading-5 font-semibold tracking-[0.03em]', authorClass(message.role))}>
					{message.author}
				</span>
				{#if message.role === 'cm'}
					<Badge variant="bot">{$t('design.chat.bot')}</Badge>
				{/if}
				<span class="text-xs leading-5 tracking-[0.02em] text-muted-foreground tabular-nums">
					{message.time}
				</span>
				{#if message.network}
					<span class="text-xs leading-5 text-muted-foreground" aria-hidden="true">·</span>
					<span class="text-xs leading-5 tracking-[0.02em] text-muted-foreground tabular-nums">
						{message.network}
					</span>
				{/if}
				{#if announcementOnly}
					<span class="text-xs leading-5 tracking-[0.02em] text-muted-foreground">
						{$t('design.chat.published')}
					</span>
				{/if}
			</div>
			{#if message.kind === 'gov'}
				<div class="flex flex-wrap items-baseline gap-1.5 text-[15px] leading-6 font-medium tracking-[0.01em] text-gov-success">
					<Landmark class="relative top-px size-3.5 shrink-0" />
					<span class="min-w-0 text-pretty">
						<ChatRichText
							text={message.text}
							proposalTitleFor={proposalTitle}
							pollTitleFor={pollTitle}
						/>
					</span>
				</div>
			{:else}
				<p class="m-0 text-[15px] leading-6 tracking-[0.01em] text-pretty text-secondary-foreground">
					<ChatRichText
						text={message.text}
						proposalTitleFor={proposalTitle}
						pollTitleFor={pollTitle}
					/>
				</p>
			{/if}
		</div>

		{#if message.embeds?.length}
			<div class="flex flex-wrap items-stretch gap-2">
				{#each message.embeds as embed, i (i)}
					{#if embed.kind === 'poll'}
						{#if embed.channel === channelId}
							<div class="w-full min-w-0">
								<PollEmbedCard
									title={embed.title}
									channel={embed.channel}
									tag={embed.tag}
									closes={embed.closes}
									options={embed.options}
								/>
							</div>
						{:else}
							<PollEmbedStrip
								title={embed.title}
								channel={embed.channel}
								tag={embed.tag}
								closes={embed.closes}
								options={embed.options}
							/>
						{/if}
					{:else if embed.kind === 'vote'}
						{#if embed.channel === channelId}
							<div class="w-full min-w-0">
								<VoteEmbedCard
									title={embed.title}
									detail={embed.detail}
									amount={embed.amount}
									quorum={embed.quorum}
									tag={embed.tag}
									proposalId={embed.proposalId}
									closes={embed.closes}
									forPct={embed.forPct}
									againstPct={embed.againstPct}
									quorumNeeded={embed.quorumNeeded}
								/>
							</div>
						{:else}
							<VoteEmbedStrip
								title={embed.title}
								channel={embed.channel}
								amount={embed.amount}
								tag={embed.tag}
								proposalId={embed.proposalId}
								closes={embed.closes}
								forPct={embed.forPct}
								againstPct={embed.againstPct}
								quorumNeeded={embed.quorumNeeded}
							/>
						{/if}
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
{/if}

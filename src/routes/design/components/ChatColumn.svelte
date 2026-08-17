<script lang="ts">
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { t } from 'svelte-i18n';
	import Hash from '@lucide/svelte/icons/hash';
	import Landmark from '@lucide/svelte/icons/landmark';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pin from '@lucide/svelte/icons/pin';
	import Plus from '@lucide/svelte/icons/plus';
	import Send from '@lucide/svelte/icons/send';
	import type { Message, MessageEmbed } from '../fixtures.js';
	import { proposalTitle } from '../fixtures.js';

	let {
		channelName,
		channelCategory = 'channels' as 'squad' | 'channels',
		messages,
		announcementOnly = false,
		onSend
	}: {
		channelName: string;
		channelCategory?: 'squad' | 'channels';
		messages: Message[];
		announcementOnly?: boolean;
		onSend: (text: string) => void;
	} = $props();

	let draft = $state('');
	const pollsChannel = '#polls';
	const governanceChannel = '#governance';

	type TextToken =
		| { kind: 'text'; value: string }
		| { kind: 'mention'; value: string }
		| { kind: 'channel'; value: string }
		| { kind: 'proposal'; value: string };

	function tokenize(text: string): TextToken[] {
		const tokens: TextToken[] = [];
		const pattern = /(@[\w.-]+|#\d+|#[\w-]+)/g;
		let last = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > last) {
				tokens.push({ kind: 'text', value: text.slice(last, match.index) });
			}
			const value = match[0];
			if (value.startsWith('@')) {
				tokens.push({ kind: 'mention', value });
			} else if (/^#\d+$/.test(value)) {
				tokens.push({ kind: 'proposal', value });
			} else {
				tokens.push({ kind: 'channel', value });
			}
			last = match.index + value.length;
		}
		if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
		return tokens;
	}

	function pollTotal(embed: Extract<MessageEmbed, { kind: 'poll' }>) {
		return embed.options.reduce((sum, option) => sum + option.votes, 0) || 1;
	}

	function submit() {
		const text = draft.trim();
		if (!text) return;
		onSend(text);
		draft = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		submit();
	}
</script>

<div class="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-page)]">
	<div
		class="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 shadow-[0_1px_0_rgba(0,0,0,0.25)]"
	>
		{#if announcementOnly}
			<Megaphone class="size-[18px] shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
		{:else if channelCategory === 'squad'}
			<Pin class="size-[18px] shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
		{:else}
			<Hash class="size-[18px] shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
		{/if}
		<span class="text-[15px] font-semibold leading-none tracking-[0.01em] text-[var(--text-primary)]">
			{channelName}
		</span>
		{#if announcementOnly}
			<span class="text-[12px] leading-none text-[var(--text-muted)]">
				{$t('design.chat.broadcastOnly')}
			</span>
			<Button variant="outline" size="sm" class="ml-auto h-7 px-2.5 text-xs">{$t('design.chat.follow')}</Button>
		{/if}
	</div>

	{#if announcementOnly}
		<div
			class="flex shrink-0 items-start gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2.5 text-[12px] leading-[1.4] text-[var(--text-muted)]"
		>
			<Megaphone class="mt-0.5 size-3.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
			<p class="text-pretty">
				{$t('design.chat.announceLead')}
				<span class="msg-chip msg-chip--channel">{pollsChannel}</span>
				{$t('design.chat.announceMid')}
				<span class="msg-chip msg-chip--channel">{governanceChannel}</span>
			</p>
		</div>
	{/if}

	<ScrollArea.Root class="min-h-0 flex-1">
		<div class="flex flex-col gap-4 px-4 py-4">
			{#each messages as message (message.id)}
				<div class="msg-row">
					{#if message.kind === 'gov'}
						<div
							class="msg-av flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#152a2a] text-[var(--gov-success)]"
						>
							<Landmark class="size-[18px]" />
						</div>
					{:else if message.role === 'cm' || message.author === 'Nova'}
						<div class="msg-av bot-hex" aria-hidden="true">
							<span
								class="bot-hex__face text-[13px] font-semibold text-[var(--text-primary)]"
								style={`background-color: ${message.color};`}
							>
								{message.initials}
							</span>
						</div>
					{:else}
						<div
							class="msg-av flex size-[38px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-[var(--text-primary)]"
							style={`background-color: ${message.color};`}
						>
							{message.initials}
						</div>
					{/if}
					<div class="msg-body">
						<div class="msg-meta">
							<span
								class={[
									'msg-author',
									message.role === 'admin' && 'text-[var(--warning)]',
									message.role === 'qm' && 'msg-author--qm',
									message.role === 'cm' && 'msg-author--cm',
									!message.role && 'text-[var(--text-primary)]'
								]
									.filter(Boolean)
									.join(' ')}
							>
								{message.author}
							</span>
							{#if message.role === 'cm'}
								<span class="msg-bot-badge">{$t('design.chat.bot')}</span>
							{/if}
							<span class="msg-time tabular-nums">
								{message.time}{#if message.network}<span aria-hidden="true"> · </span>{message.network}{/if}
							</span>
							{#if announcementOnly}
								<span class="msg-published">{$t('design.chat.published')}</span>
							{/if}
						</div>
						{#if message.kind === 'gov'}
							<div class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-[var(--gov-success)]">
								<Landmark class="size-3.5 shrink-0" />
								<span class="text-pretty">
									{#each tokenize(message.text) as token, i (i)}
										{#if token.kind === 'proposal'}
											{@const title = proposalTitle(token.value) ?? $t('design.chat.proposalFallback')}
											<span class="msg-chip msg-chip--proposal">
												<span class="msg-chip__num">{token.value}</span>
												<span class="msg-chip__title">{title}</span>
											</span>
										{:else if token.kind === 'mention'}
											<span class="msg-chip msg-chip--mention">{token.value}</span>
										{:else if token.kind === 'channel'}
											<span class="msg-chip msg-chip--channel">{token.value}</span>
										{:else}
											{token.value}
										{/if}
									{/each}
								</span>
							</div>
						{:else}
							<p class="text-pretty text-sm leading-[1.45] text-[var(--text-secondary)]">
								{#each tokenize(message.text) as token, i (i)}
									{#if token.kind === 'mention'}
										<span class="msg-chip msg-chip--mention">{token.value}</span>
									{:else if token.kind === 'proposal'}
										{@const title = proposalTitle(token.value) ?? $t('design.chat.proposalFallback')}
										<span class="msg-chip msg-chip--proposal">
											<span class="msg-chip__num">{token.value}</span>
											<span class="msg-chip__title">{title}</span>
										</span>
									{:else if token.kind === 'channel'}
										<span class="msg-chip msg-chip--channel">{token.value}</span>
									{:else}
										{token.value}
									{/if}
								{/each}
							</p>
						{/if}

						{#if message.embed?.kind === 'poll'}
							{@const embed = message.embed}
							{@const total = pollTotal(embed)}
							<div class="embed-card">
								<div class="embed-card__top">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="tag tag--accent">{embed.tag ?? $t('design.chat.pollTag')}</span>
										<span class="tag">#{embed.channel}</span>
									</div>
									<span class="tag tag--urgent tabular-nums">{embed.closes}</span>
								</div>
								<div class="embed-card__title">{embed.title}</div>
								<div class="mt-3 flex flex-col gap-2">
									{#each embed.options as option, index (option.label)}
										{@const pct = Math.round((option.votes / total) * 100)}
										{@const letter = String.fromCharCode(65 + index)}
										<button
											type="button"
											class="poll-option"
											class:poll-option--selected={option.selected}
											style={`--pct: ${pct}%`}
										>
											<span class="poll-option__letter">{letter}</span>
											<span class="relative z-10 min-w-0 flex-1 truncate text-left"
												>{option.label}</span
											>
											{#if option.voters && option.voters.length > 0}
												<span class="voter-stack relative z-10">
													{#each option.voters.slice(0, 3) as voter (voter.initials + voter.color)}
														<span
															class="voter-stack__av"
															style={`background-color: ${voter.color};`}
															>{voter.initials}</span
														>
													{/each}
												</span>
											{/if}
											<span class="relative z-10 shrink-0 text-[12px] tabular-nums text-[var(--text-muted)]"
												>{option.votes} · {pct}%</span
											>
										</button>
									{/each}
								</div>
								<div class="embed-card__footer">
									<span>{$t('design.chat.expires', { values: { when: embed.closes } })}</span>
									<span class="tabular-nums text-[var(--text-secondary)]"
										>{$t('design.chat.voted', { values: { count: total } })}</span
									>
								</div>
								{#if announcementOnly}
									<div class="embed-card__cta">{$t('design.chat.openToVote', { values: { channel: embed.channel } })}</div>
								{/if}
							</div>
						{:else if message.embed?.kind === 'vote'}
							{@const embed = message.embed}
							{@const forPct = embed.forPct ?? 50}
							{@const againstPct = embed.againstPct ?? 50}
							<div class="embed-card embed-card--vote">
								<div class="embed-card__top">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="tag tag--proposal">{embed.tag ?? $t('design.chat.proposalFallback')}</span>
										<span class="tag">{$t('design.chat.voteTreasury')}</span>
									</div>
									{#if embed.closes}
										<span class="tag tag--urgent tabular-nums">{embed.closes}</span>
									{/if}
								</div>
								<div class="embed-card__title">
									{#if embed.proposalId}
										<span class="embed-card__prop-num">#{embed.proposalId}</span>
									{/if}
									{embed.title}
								</div>
								<p class="mt-1 text-pretty text-[13px] leading-[1.4] text-[var(--text-muted)]">
									{embed.detail}
								</p>
								<div class="mt-3 grid grid-cols-3 gap-2">
									<div class="stat-cell">
										<span class="stat-cell__label">{$t('design.chat.amount')}</span>
										<span class="stat-cell__value tabular-nums">{embed.amount}</span>
									</div>
									<div class="stat-cell">
										<span class="stat-cell__label">{$t('design.chat.for')}</span>
										<span class="stat-cell__value tabular-nums text-[var(--gov-success)]"
											>{forPct}%</span
										>
									</div>
									<div class="stat-cell">
										<span class="stat-cell__label">{$t('design.chat.quorum')}</span>
										<span class="stat-cell__value tabular-nums">{embed.quorum}</span>
									</div>
								</div>
								<div class="split-bar mt-3" style={`--for: ${forPct}%; --against: ${againstPct}%`}>
									<span class="split-bar__for"></span>
									<span class="split-bar__against"></span>
								</div>
								<div class="embed-card__footer">
									<span class="text-[var(--gov-success)]"
										>{$t('design.chat.forPct', { values: { pct: forPct } })}</span
									>
									<span class="text-[var(--danger)]"
										>{$t('design.chat.againstPct', { values: { pct: againstPct } })}</span
									>
								</div>
								{#if announcementOnly}
									<div class="embed-card__cta">{$t('design.chat.castOnTreasury')}</div>
								{:else}
									<div class="mt-3 grid grid-cols-2 gap-2">
										<button type="button" class="vote-btn vote-btn--for">{$t('design.chat.voteFor')}</button>
										<button type="button" class="vote-btn vote-btn--against">{$t('design.chat.voteAgainst')}</button>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</ScrollArea.Root>

	{#if announcementOnly}
		<div
			class="mx-4 mb-4 flex shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-3 text-center text-[12px] text-[var(--text-muted)]"
		>
			{$t('design.chat.publishOnly')}
		</div>
	{:else}
		<div class="composer-bar">
			<Button variant="ghost" size="icon-sm" aria-label={$t('design.chat.attach')}>
				<Plus class="size-[18px] text-[var(--text-muted)]" />
			</Button>
			<input
				type="text"
				bind:value={draft}
				onkeydown={handleKeydown}
				placeholder={$t('design.chat.composerPlaceholder', { values: { channel: channelName } })}
				aria-label={$t('design.chat.composerLabel', { values: { channel: channelName } })}
				class="composer-input"
			/>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={$t('design.chat.sendMessage')}
				disabled={!draft.trim()}
				onclick={submit}
			>
				<Send class="size-[18px]" />
			</Button>
		</div>
	{/if}
</div>

<style>
	.composer-input {
		appearance: none;
		flex: 1;
		height: auto;
		border: 0;
		background: transparent;
		padding: 0;
		color: var(--text-primary);
		font-family: var(--font-ui);
		font-size: 0.875rem;
		box-shadow: none;
	}

	.composer-input:focus-visible {
		outline: none;
	}

	.composer-bar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 12px;
		margin: 0 16px 16px;
		padding: 12px 16px;
		border-radius: 8px;
		background: var(--bg-elevated);
	}


	.msg-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.msg-av {
		margin-top: 2px; /* optical: sit with author cap-height, not glyph box */
	}

	.msg-body {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 8px;
	}

	.msg-meta {
		display: flex;
		min-height: 20px;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.msg-author {
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1;
	}

	.msg-author--qm {
		color: #8babc8;
	}

	.msg-author--cm {
		color: #c5d4e8;
	}

	.msg-bot-badge {
		display: inline-flex;
		height: 16px;
		align-items: center;
		border-radius: 4px;
		padding: 0 5px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1;
		color: #c5d4e8;
		background: color-mix(in srgb, #c5d4e8 12%, transparent);
	}

	.msg-time {
		font-size: 11px;
		line-height: 1;
		color: var(--text-muted);
	}

	.msg-published {
		font-size: 11px;
		line-height: 1;
		color: var(--text-muted);
		opacity: 0.72;
	}

	.bot-hex {
		position: relative;
		width: 38px;
		height: 38px;
		flex-shrink: 0;
	}

	.bot-hex::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			145deg,
			#f2f5f8 0%,
			#9aa8b8 28%,
			#e8eef4 48%,
			#6b7c8f 72%,
			#cfd8e2 100%
		);
		clip-path: polygon(50% 0%, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
	}

	.bot-hex__face {
		position: absolute;
		inset: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		clip-path: polygon(50% 0%, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
	}

	.msg-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 4px;
		padding: 1px 5px;
		font-weight: 500;
		white-space: nowrap;
		vertical-align: baseline;
	}

	.msg-chip--mention {
		background: color-mix(in srgb, var(--brand) 22%, transparent);
		color: #ffb37a;
	}

	.msg-chip--channel {
		background: color-mix(in srgb, var(--bg-hover) 90%, transparent);
		color: var(--text-primary);
	}

	.msg-chip--proposal {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: min(100%, 320px);
		padding: 1px 6px 1px 5px;
		background: color-mix(in srgb, var(--warning) 14%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 28%, transparent);
		color: var(--warning);
		vertical-align: baseline;
	}

	.msg-chip__num {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		opacity: 0.8;
	}

	.msg-chip__title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--warning);
		font-weight: 500;
	}

	.embed-card {
		margin-top: 4px;
		max-width: 440px;
		border-radius: 12px;
		padding: 12px;
		background: var(--bg-panel);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--border) 55%, transparent),
			0 8px 24px rgba(0, 0, 0, 0.28);
	}

	.embed-card--vote {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--gov-success) 35%, var(--border-subtle)),
			0 8px 24px rgba(0, 0, 0, 0.28);
	}

	.embed-card__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.embed-card__title {
		margin-top: 8px;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text-primary);
		text-wrap: balance;
	}

	.embed-card__prop-num {
		margin-right: 6px;
		font-variant-numeric: tabular-nums;
		color: var(--warning);
		opacity: 0.9;
	}

	.embed-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 12px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.embed-card__cta {
		margin-top: 12px;
		border-radius: 8px;
		padding: 8px 12px;
		text-align: center;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--bg-elevated);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 80%, transparent);
	}

	.tag {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary);
		background: var(--bg-elevated);
	}

	.tag--accent {
		color: #ffb37a;
		background: color-mix(in srgb, var(--brand) 18%, transparent);
	}

	.tag--success {
		color: var(--gov-success);
		background: color-mix(in srgb, var(--gov-success) 14%, transparent);
	}

	.tag--proposal {
		color: var(--warning);
		background: color-mix(in srgb, var(--warning) 14%, transparent);
	}

	.tag--urgent {
		color: #fecaca;
		background: color-mix(in srgb, var(--danger) 18%, transparent);
	}

	.poll-option {
		-webkit-appearance: none;
		appearance: none;
		position: relative;
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		border: 0;
		outline: none;
		border-radius: 8px;
		padding: 8px;
		font-size: 13px;
		color: var(--text-secondary);
		background-color: color-mix(in srgb, var(--bg-elevated) 85%, transparent);
		background-image: none;
		box-shadow: none;
		cursor: pointer;
		transition: transform 140ms var(--ease-out);
	}

	.poll-option::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--pct);
		background: color-mix(in srgb, var(--brand) 16%, transparent);
	}

	.poll-option:active {
		transform: scale(0.98);
	}

	.poll-option--selected {
		color: var(--text-primary);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 50%, transparent);
	}

	.poll-option__letter {
		position: relative;
		z-index: 10;
		display: flex;
		height: 20px;
		width: 20px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-primary);
		background: color-mix(in srgb, var(--bg-hover) 90%, transparent);
	}

	.voter-stack {
		display: flex;
		flex-shrink: 0;
		align-items: center;
	}

	.voter-stack__av {
		display: flex;
		height: 18px;
		width: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 2px solid var(--bg-panel);
		margin-left: -6px;
		font-size: 8px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.voter-stack__av:first-child {
		margin-left: 0;
	}

	.stat-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-radius: 8px;
		padding: 8px;
		background: var(--bg-elevated);
	}

	.stat-cell__label {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.stat-cell__value {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.split-bar {
		display: flex;
		height: 8px;
		overflow: hidden;
		border-radius: 999px;
		gap: 3px;
		background: transparent;
	}

	.split-bar__for {
		width: var(--for);
		border-radius: 999px 2px 2px 999px;
		background: var(--gov-success);
	}

	.split-bar__against {
		width: var(--against);
		border-radius: 2px 999px 999px 2px;
		background: color-mix(in srgb, var(--danger) 85%, white 10%);
	}

	.vote-btn {
		-webkit-appearance: none;
		appearance: none;
		height: 36px;
		border: 0;
		outline: none;
		border-radius: 8px;
		background-image: none;
		box-shadow: none;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: transform 140ms var(--ease-out);
	}

	.vote-btn:active {
		transform: scale(0.96);
	}

	.vote-btn--for {
		color: #062016;
		background: var(--gov-success);
	}

	.vote-btn--against {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--danger) 28%, var(--bg-elevated));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 45%, transparent);
	}

	.poll-option:focus-visible,
	.vote-btn:focus-visible {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
		outline: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.poll-option,
		.vote-btn {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import ChatFrame from '../../components/shell/ChatFrame.svelte';
	import { parseShellPreviewState, type ChatFrameLabels } from '$lib/shell';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import ChatColumn from './components/ChatColumn.svelte';
	import { design } from './design-state.svelte.js';
	import { overlayMessages } from './fixtures';

	const previewState = $derived(parseShellPreviewState(page.url.searchParams.get('state')));
	const showChat = $derived(
		Boolean(design.activeChannel && design.activeChannel.id !== 'dashboard'),
	);
	const visibleMessages = $derived(overlayMessages(design.messageList, previewState));
	const chromeState = $derived(
		previewState === 'loading' || previewState === 'empty' || previewState === 'error'
			? previewState
			: 'default',
	);

	const chatLabels = $derived<ChatFrameLabels>({
		region: $t('design.chat.region'),
		loading: $t('design.chat.loading'),
		emptyTitle: $t('design.chat.emptyTitle'),
		emptyBody: $t('design.chat.emptyBody'),
		errorTitle: $t('design.chat.errorTitle'),
		errorBody: $t('design.chat.errorBody'),
		retry: $t('design.chat.retry'),
	});

	function retryPreview(): void {
		const url = new URL(page.url);
		url.searchParams.set('state', 'default');
		const destination: `/design?${string}` = `/design?${url.searchParams.toString()}`;
		replaceState(resolve(destination), page.state);
	}
</script>

{#if chromeState !== 'default'}
	<ChatFrame
		title={design.activeChannel?.name ?? $t('design.chat.pickTitle')}
		subtitle={design.activeSquad?.name}
		kind={design.activeChannel?.id === 'announcements' ? 'announcement' : 'text'}
		state={chromeState}
		labels={chatLabels}
		onRetry={retryPreview}
	>
		<div></div>
	</ChatFrame>
{:else if showChat && design.activeChannel}
	<ChatColumn
		channelName={design.activeChannel.name}
		channelCategory={design.activeChannel.category}
		announcementOnly={design.activeChannel.id === 'announcements'}
		messages={visibleMessages}
		onSend={(text) => design.sendMessage(text, $t('design.chat.justNow'))}
	/>
{:else}
	<div
		class="flex h-full flex-col items-center justify-center gap-2 bg-[var(--bg-page)] px-6 text-center"
	>
		<p class="text-[15px] font-medium text-balance text-[var(--text-primary)]">
			{$t('design.chat.pickTitle')}
		</p>
		<p class="max-w-sm text-sm text-pretty text-[var(--text-muted)]">
			{$t('design.chat.pickBody')}
		</p>
	</div>
{/if}

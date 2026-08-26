<script lang="ts">
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import ChatFrame from '../../components/shell/ChatFrame.svelte';
	import { parseShellPreviewState, type ChatFrameLabels } from '$lib/shell';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import ChatColumn from './components/ChatColumn.svelte';
	import { design } from './design-state.svelte.js';
	import { memberToggleFaces, members, overlayMessages } from './fixtures';

	const previewState = $derived(parseShellPreviewState(page.url.searchParams.get('state')));
	const showChat = $derived(
		Boolean(design.activeChannel && design.activeChannel.id !== 'dashboard'),
	);
	const visibleMessages = $derived(overlayMessages(design.messageList, previewState));
	const memberFaces = $derived(memberToggleFaces(members, previewState));
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
	{#key design.activeChannel.id}
		<ChatColumn
			channelId={design.activeChannel.id}
			channelName={design.activeChannel.name}
			channelCategory={design.activeChannel.category}
			announcementOnly={design.activeChannel.id === 'announcements'}
			messages={visibleMessages}
			membersCollapsed={design.asideCollapsed}
			{memberFaces}
			onSend={(text) => design.sendMessage(text, $t('design.chat.justNow'))}
			onToggleMembers={() => (design.asideCollapsed = !design.asideCollapsed)}
		/>
	{/key}
{:else}
	<div
		class="shell-dither-seam relative flex h-full flex-col items-center justify-center gap-2 overflow-hidden rounded-tl-lg bg-background px-6 text-center"
	>
		<div class="shell-grid-void pointer-events-none absolute inset-0" aria-hidden="true"></div>
		<p class="relative z-10 m-0 text-[15px] font-medium text-balance text-foreground">
			{$t('design.chat.pickTitle')}
		</p>
		<p class="relative z-10 max-w-sm text-sm text-pretty text-muted-foreground">
			{$t('design.chat.pickBody')}
		</p>
	</div>
{/if}

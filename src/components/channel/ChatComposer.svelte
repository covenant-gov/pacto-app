<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Send from '@lucide/svelte/icons/send';
	import { t } from 'svelte-i18n';

	let {
		channelName,
		onSend,
	}: {
		channelName: string;
		onSend: (text: string) => void;
	} = $props();

	let draft = $state('');

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

<div class="mx-4 mb-4 flex shrink-0 items-center gap-3 rounded-lg bg-secondary px-4 py-3">
	<Button variant="ghost" size="icon-sm" aria-label={$t('design.chat.attach')}>
		<Plus class="size-[18px]" />
	</Button>
	<Input
		type="text"
		variant="ghost"
		bind:value={draft}
		onkeydown={handleKeydown}
		placeholder={$t('design.chat.composerPlaceholder', { values: { channel: channelName } })}
		aria-label={$t('design.chat.composerLabel', { values: { channel: channelName } })}
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

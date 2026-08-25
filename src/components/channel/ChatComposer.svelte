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
	const canSend = $derived(draft.trim().length > 0);

	function submit() {
		const text = draft.trim();
		if (!text) return;
		onSend(text);
		draft = '';
	}

	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		submit();
	}
</script>

<form
	class="chat-composer mx-4 flex shrink-0 items-center gap-3 rounded-lg bg-secondary px-4 py-3"
	data-ready={canSend ? 'true' : undefined}
	aria-label={$t('design.chat.composer')}
	onsubmit={onSubmit}
>
	<Button type="button" variant="ghost" size="icon-sm" aria-label={$t('design.chat.attach')}>
		<Plus class="size-[18px]" />
	</Button>
	<Input
		type="text"
		name="message"
		variant="ghost"
		autocomplete="off"
		enterkeyhint="send"
		class="min-h-6 text-[15px] leading-5"
		bind:value={draft}
		placeholder={$t('design.chat.composerPlaceholder', { values: { channel: channelName } })}
		aria-label={$t('design.chat.composerLabel', { values: { channel: channelName } })}
	/>
	<Button
		type="submit"
		variant={canSend ? 'default' : 'ghost'}
		size="icon-sm"
		aria-label={$t('design.chat.sendMessage')}
		disabled={!canSend}
	>
		<Send class="size-[18px] translate-x-px" />
	</Button>
</form>

<style>
	.chat-composer {
		position: relative;
		touch-action: manipulation;
		-webkit-tap-highlight-color: color-mix(in oklch, var(--brand) 18%, transparent);
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--brand) 28%, transparent);
	}

	.chat-composer[data-ready='true'] {
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--brand) 42%, transparent);
	}

	.chat-composer:hover {
		background-color: color-mix(in oklch, var(--brand) 6%, var(--bg-elevated));
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--brand) 46%, transparent);
	}

	.chat-composer:focus-within {
		background-color: color-mix(in oklch, var(--brand) 8%, var(--bg-elevated));
		box-shadow: 0 0 0 1px var(--brand);
	}

	.chat-composer::after {
		content: '';
		pointer-events: none;
		position: absolute;
		inset: -3px;
		border-radius: calc(var(--radius) + 3px);
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--brand) 32%, transparent);
		opacity: 0;
		transition: opacity 160ms var(--ease-out);
	}

	.chat-composer:focus-within::after {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-composer::after {
			transition: none;
		}
	}

	@media (forced-colors: active) {
		.chat-composer {
			border: 1px solid ButtonBorder;
			box-shadow: none;
		}

		.chat-composer:focus-within {
			outline: 2px solid Highlight;
			outline-offset: 2px;
		}

		.chat-composer::after {
			content: none;
		}
	}
</style>

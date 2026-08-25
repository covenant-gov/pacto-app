<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { t } from 'svelte-i18n';
	import type { Snippet } from 'svelte';
	import { design } from '../design-state.svelte.js';
	import { ditherMaskStyle } from '../dither.js';

	let {
		awayFromLatest,
		onJump,
		children,
	}: {
		awayFromLatest: boolean;
		onJump: () => void;
		children: Snippet;
	} = $props();
</script>

<div
	class="shell-dither-arc pointer-events-none absolute inset-x-0 bottom-0 z-10"
	data-away={awayFromLatest ? 'true' : undefined}
>
	<div class="shell-dither-arc-bowl" aria-hidden="true">
		<div class="shell-dither-arc-wash" style={ditherMaskStyle(design.ditherPattern)}></div>
	</div>
	<div class="relative z-10 flex pointer-events-auto w-full flex-col gap-2 pt-28 pb-4">
		{#if awayFromLatest}
			<Button variant="secondary" size="sm" class="mx-auto rounded-full" onclick={onJump}>
				{$t('design.chat.jumpToLatest')}
			</Button>
		{/if}
		<div class="w-full">
			{@render children()}
		</div>
	</div>
</div>

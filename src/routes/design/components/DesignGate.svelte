<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Button } from '$lib/components/ui/button/index.js';

	let { onClose }: { onClose: () => void } = $props();

	let unlockButton: HTMLButtonElement | HTMLAnchorElement | null = $state(null);

	$effect(() => {
		unlockButton?.focus();
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="shell-gate absolute inset-0 z-30 flex flex-col overflow-hidden bg-background"
	role="dialog"
	aria-modal="true"
	aria-labelledby="design-gate-title"
>
	<div class="shell-grid-void pointer-events-none absolute inset-0" aria-hidden="true"></div>
	<div class="shell-dither-wash pointer-events-none absolute inset-0" aria-hidden="true"></div>
	<div class="shell-gate-scan pointer-events-none absolute inset-0" aria-hidden="true"></div>
	<div class="shell-gate-well pointer-events-none absolute inset-0" aria-hidden="true"></div>

	<div class="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6">
		<p class="font-mono text-[10px] tracking-[0.2em] text-foreground/80 uppercase tabular-nums">
			{$t('design.gate.clock')}
		</p>

		<div class="flex flex-col items-center gap-2">
			<p
				id="design-gate-title"
				class="shell-gate-split m-0 font-mono text-[1.75rem] font-semibold tracking-[0.28em] text-foreground"
			>
				{$t('design.gate.wordmark')}
			</p>
			<p class="font-mono text-[11px] tracking-[0.22em] text-foreground/70 uppercase">
				{$t('design.gate.sealed')}
			</p>
		</div>

		<div class="flex gap-2.5" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
				<span class="shell-gate-pin" data-active={slot === 0 ? 'true' : undefined}></span>
			{/each}
		</div>

		<p class="max-w-xs text-center text-sm leading-6 text-pretty text-foreground/85">
			{$t('design.gate.hint')}
		</p>

		<div class="flex items-center gap-2">
			<Button bind:ref={unlockButton} type="button" onclick={onClose}>
				{$t('design.gate.unlock')}
			</Button>
			<Button type="button" variant="ghost" class="text-foreground" onclick={onClose}>
				{$t('design.gate.close')}
			</Button>
		</div>
	</div>
</div>

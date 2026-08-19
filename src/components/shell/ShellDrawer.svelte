<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	interface Props {
		open?: boolean;
		side: 'left' | 'right';
		label: string;
		closeLabel: string;
		children: Snippet;
		returnFocusTo?: HTMLElement | null;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(false),
		side,
		label,
		closeLabel,
		children,
		returnFocusTo = null,
		onOpenChange,
	}: Props = $props();

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		onOpenChange?.(nextOpen);
		if (!nextOpen) {
			queueMicrotask(() => returnFocusTo?.focus());
		}
	}
</script>

<DialogPrimitive.Root {open} onOpenChange={handleOpenChange}>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-[10040] bg-black/45 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
		/>
		<DialogPrimitive.Content
			class={cn(
				'fixed inset-y-0 z-[10050] w-[min(20rem,calc(100vw-3rem))] overflow-hidden border-border bg-muted text-foreground shadow-2xl outline-none overscroll-contain data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none',
				side === 'left'
					? 'left-0 border-r data-open:slide-in-from-left data-closed:slide-out-to-left'
					: 'right-0 border-l data-open:slide-in-from-right data-closed:slide-out-to-right',
			)}
		>
			<DialogPrimitive.Title class="sr-only">{label}</DialogPrimitive.Title>
			<DialogPrimitive.Close>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="absolute top-2 right-2 z-10"
						aria-label={closeLabel}
					>
						<X class="size-4" aria-hidden="true" />
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
			<div class="h-full min-h-0 overscroll-contain">{@render children()}</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>

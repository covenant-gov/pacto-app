<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

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
		<DialogPrimitive.Overlay class="shell-drawer-overlay fixed inset-0 z-[10040] bg-black/45" />
		<DialogPrimitive.Content
			class={`shell-drawer ${side === 'left' ? 'drawer-left' : 'drawer-right'} fixed inset-y-0 z-[10050] w-[min(20rem,calc(100vw-3rem))] overflow-hidden border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-2xl outline-none`}
		>
			<DialogPrimitive.Title class="sr-only">{label}</DialogPrimitive.Title>
			<DialogPrimitive.Close
				class="drawer-close absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-md border border-transparent text-[var(--text-secondary)] outline-none"
				aria-label={closeLabel}
			>
				<X class="size-4" aria-hidden="true" />
			</DialogPrimitive.Close>
			<div class="h-full min-h-0 overscroll-contain">{@render children()}</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>

<style>
	:global(.drawer-close) {
		appearance: none;
		background: transparent;
		box-shadow: none;
	}

	:global(.shell-drawer-overlay) {
		animation: drawer-overlay-in 160ms ease-out;
	}

	:global(.shell-drawer) {
		animation-duration: 180ms;
		animation-timing-function: var(--ease-out);
		animation-fill-mode: both;
		overscroll-behavior: contain;
	}

	:global(.drawer-left) {
		left: 0;
		border-right-width: 1px;
		animation-name: drawer-left-in;
		transform-origin: left center;
	}

	:global(.drawer-right) {
		right: 0;
		border-left-width: 1px;
		animation-name: drawer-right-in;
		transform-origin: right center;
	}

	:global(.drawer-close:focus-visible) {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent);
	}

	@media (hover: hover) and (pointer: fine) {
		:global(.drawer-close:hover) {
			background: var(--bg-hover);
			color: var(--text-primary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.shell-drawer),
		:global(.shell-drawer-overlay) {
			animation-duration: 1ms;
		}
	}

	@keyframes drawer-overlay-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes drawer-left-in {
		from {
			opacity: 0;
			transform: translateX(-100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes drawer-right-in {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>

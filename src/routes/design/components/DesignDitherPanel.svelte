<script lang="ts">
	import Blend from '@lucide/svelte/icons/blend';
	import { t } from 'svelte-i18n';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';
	import { design } from '../design-state.svelte.js';
	import { DITHER_PATTERNS, ditherPatternMaskImage, type DitherPattern } from '../dither.js';

	function setNumber(field: 'ditherMix' | 'ditherTile' | 'ditherEdge', event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		design[field] = value;
	}

	function selectPattern(pattern: DitherPattern): void {
		design.ditherPattern = pattern;
	}

	function patternThumbStyle(pattern: DitherPattern): string {
		const mask = ditherPatternMaskImage(pattern);
		return [
			`mask-image: ${mask}`,
			`mask-size: 8px 8px`,
			`mask-repeat: repeat`,
			`-webkit-mask-image: ${mask}`,
			`-webkit-mask-size: 8px 8px`,
			`-webkit-mask-repeat: repeat`,
		].join('; ');
	}
</script>

<div class="flex shrink-0 items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase whitespace-nowrap">
	<Blend class="size-3.5" aria-hidden="true" />
	<span class="max-[560px]:sr-only">{$t('design.toolbar.dither')}</span>
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="secondary"
					size="xs"
					class="h-[26px] min-w-[104px] justify-between px-2 text-xs font-medium normal-case tracking-normal"
					aria-label={$t('design.toolbar.dither')}
				>
					<span class="truncate tabular-nums">
						{$t('design.dither.summary', {
							values: {
								mix: design.ditherMix,
								tile: design.ditherTile,
								pattern: $t(`design.dither.pattern.${design.ditherPattern}`),
							},
						})}
					</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="end" class="w-72 gap-3 p-3" aria-label={$t('design.dither.title')}>
			<div class="flex items-center justify-between gap-2">
				<Popover.Title class="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
					{$t('design.dither.title')}
				</Popover.Title>
				<Button variant="ghost" size="xs" onclick={() => (design.gateOpen = true)}>
					{$t('design.dither.gate')}
				</Button>
				<Button variant="ghost" size="xs" onclick={() => design.resetDither()}>
					{$t('design.dither.reset')}
				</Button>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label class="text-xs font-medium text-foreground" id="design-dither-pattern-label">
					{$t('design.dither.pattern')}
				</Label>
				<div
					class="grid grid-cols-4 gap-1"
					role="radiogroup"
					aria-labelledby="design-dither-pattern-label"
				>
					{#each DITHER_PATTERNS as pattern (pattern)}
						<button
							type="button"
							role="radio"
							class={cn(
								'flex h-8 items-center justify-center rounded-md border border-transparent bg-muted',
								'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
								design.ditherPattern === pattern && 'border-border bg-accent',
							)}
							aria-checked={design.ditherPattern === pattern}
							aria-label={$t(`design.dither.pattern.${pattern}`)}
							title={$t(`design.dither.pattern.${pattern}`)}
							onclick={() => selectPattern(pattern)}
						>
							<span class="size-5 bg-foreground" style={patternThumbStyle(pattern)} aria-hidden="true"></span>
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-2">
					<Label class="text-xs font-medium text-foreground" for="design-dither-mix">
						{$t('design.dither.mix')}
					</Label>
					<span class="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
						{$t('design.dither.mixValue', { values: { value: design.ditherMix } })}
					</span>
				</div>
				<input
					id="design-dither-mix"
					type="range"
					min="8"
					max="70"
					step="1"
					value={design.ditherMix}
					class="h-6 w-full cursor-pointer accent-primary"
					aria-valuemin={8}
					aria-valuemax={70}
					aria-valuenow={design.ditherMix}
					oninput={(event) => setNumber('ditherMix', event)}
				/>
			</div>

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-2">
					<Label class="text-xs font-medium text-foreground" for="design-dither-tile">
						{$t('design.dither.tile')}
					</Label>
					<span class="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
						{$t('design.dither.tileValue', { values: { value: design.ditherTile } })}
					</span>
				</div>
				<input
					id="design-dither-tile"
					type="range"
					min="4"
					max="48"
					step="1"
					value={design.ditherTile}
					class="h-6 w-full cursor-pointer accent-primary"
					aria-valuemin={4}
					aria-valuemax={48}
					aria-valuenow={design.ditherTile}
					oninput={(event) => setNumber('ditherTile', event)}
				/>
			</div>

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-2">
					<Label class="text-xs font-medium text-foreground" for="design-dither-edge">
						{$t('design.dither.edge')}
					</Label>
					<span class="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
						{$t('design.dither.edgeValue', { values: { value: design.ditherEdge } })}
					</span>
				</div>
				<input
					id="design-dither-edge"
					type="range"
					min="4"
					max="28"
					step="1"
					value={design.ditherEdge}
					class="h-6 w-full cursor-pointer accent-primary"
					aria-valuemin={4}
					aria-valuemax={28}
					aria-valuenow={design.ditherEdge}
					oninput={(event) => setNumber('ditherEdge', event)}
				/>
			</div>
		</Popover.Content>
	</Popover.Root>
</div>

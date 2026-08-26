<script lang="ts">
	import Palette from '@lucide/svelte/icons/palette';
	import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { t } from 'svelte-i18n';
	import { THEME_OPTIONS } from '../../stores/theme';
	import type { ShellPreviewState } from '$lib/shell';
	import DesignDitherPanel from './components/DesignDitherPanel.svelte';
	import { SKETCH_THEME_OPTIONS, type DesignTheme } from './sketches/sketches';

	interface Props {
		theme: DesignTheme;
		previewState: ShellPreviewState;
		onThemeChange: (theme: DesignTheme) => void;
		onPreviewStateChange: (state: ShellPreviewState) => void;
	}

	let { theme, previewState, onThemeChange, onPreviewStateChange }: Props = $props();

	const previewStates: ShellPreviewState[] = [
		'default',
		'loading',
		'empty',
		'error',
		'dense',
		'long',
	];

	const themeLabel = $derived(
		[...THEME_OPTIONS, ...SKETCH_THEME_OPTIONS].find((option) => option.value === theme)?.label ??
			theme,
	);

	function selectTheme(value: string): void {
		if (value) onThemeChange(value as DesignTheme);
	}
</script>

<header
	class="flex h-9 shrink-0 items-center justify-between gap-4 overflow-x-auto border-b border-border bg-background/88 px-3 text-secondary-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
	<div class="flex shrink-0 items-center gap-2">
		<PanelsTopLeft class="size-4" aria-hidden="true" />
		<strong class="text-[0.6875rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase whitespace-nowrap">
			{$t('design.toolbar.title')}
		</strong>
		<span class="max-[560px]:sr-only font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase opacity-70">
			{$t('design.toolbar.devOnly')}
		</span>
	</div>

	<div class="flex shrink-0 items-center gap-2.5">
		<DesignDitherPanel />
		<div class="flex shrink-0 items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase whitespace-nowrap">
			<Palette class="size-3.5" aria-hidden="true" />
			<span class="max-[560px]:sr-only">{$t('design.toolbar.theme')}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="secondary"
							size="xs"
							class="h-[26px] min-w-[148px] justify-between px-2 text-xs font-medium normal-case tracking-normal"
							aria-label={$t('design.toolbar.theme')}
						>
							<span class="truncate">{themeLabel}</span>
							<ChevronDown class="size-3 shrink-0 opacity-70" aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-48">
					<DropdownMenu.RadioGroup value={theme} onValueChange={selectTheme}>
						<DropdownMenu.GroupHeading class="text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
							{$t('design.toolbar.themeShipped')}
						</DropdownMenu.GroupHeading>
						{#each THEME_OPTIONS as option (option.value)}
							<DropdownMenu.RadioItem value={option.value} onSelect={() => selectTheme(option.value)}>
								{option.label}
							</DropdownMenu.RadioItem>
						{/each}
						<DropdownMenu.Separator />
						<DropdownMenu.GroupHeading class="text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
							{$t('design.toolbar.themeSketches')}
						</DropdownMenu.GroupHeading>
						{#each SKETCH_THEME_OPTIONS as option (option.value)}
							<DropdownMenu.RadioItem value={option.value} onSelect={() => selectTheme(option.value)}>
								{option.label}
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
		<div class="flex shrink-0 items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase whitespace-nowrap">
			<span class="max-[560px]:sr-only">{$t('design.toolbar.state')}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="secondary"
							size="xs"
							class="h-[26px] min-w-[104px] justify-between px-2 text-xs font-medium normal-case tracking-normal"
							aria-label={$t('design.toolbar.state')}
						>
							<span class="truncate">{$t(`design.state.${previewState}`)}</span>
							<ChevronDown class="size-3 shrink-0 opacity-70" aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-36">
					<DropdownMenu.RadioGroup
						value={previewState}
						onValueChange={(value) => {
							if (value) onPreviewStateChange(value as ShellPreviewState);
						}}
					>
						{#each previewStates as state (state)}
							<DropdownMenu.RadioItem value={state}>
								{$t(`design.state.${state}`)}
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</header>

<script lang="ts">
	import Palette from '@lucide/svelte/icons/palette';
	import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { t } from 'svelte-i18n';
	import { THEME_OPTIONS, type Theme } from '../../stores/theme';
	import type { ShellPreviewState } from '$lib/shell';

	interface Props {
		theme: Theme;
		previewState: ShellPreviewState;
		onThemeChange: (theme: Theme) => void;
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
		THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme,
	);
</script>

<header class="design-toolbar">
	<div class="toolbar-brand">
		<PanelsTopLeft class="size-4" aria-hidden="true" />
		<strong>{$t('design.toolbar.title')}</strong>
		<span>{$t('design.toolbar.devOnly')}</span>
	</div>

	<div class="toolbar-controls">
		<div class="toolbar-field">
			<Palette class="size-3.5" aria-hidden="true" />
			<span>{$t('design.toolbar.theme')}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="toolbar-select"
							aria-label={$t('design.toolbar.theme')}
						>
							<span class="toolbar-select__value">{themeLabel}</span>
							<ChevronDown class="size-3 shrink-0 opacity-70" aria-hidden="true" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-36">
					<DropdownMenu.RadioGroup
						value={theme}
						onValueChange={(value) => {
							if (value) onThemeChange(value as Theme);
						}}
					>
						{#each THEME_OPTIONS as option (option.value)}
							<DropdownMenu.RadioItem value={option.value}>{option.label}</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
		<div class="toolbar-field">
			<span>{$t('design.toolbar.state')}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="toolbar-select"
							aria-label={$t('design.toolbar.state')}
						>
							<span class="toolbar-select__value">{$t(`design.state.${previewState}`)}</span>
							<ChevronDown class="size-3 shrink-0 opacity-70" aria-hidden="true" />
						</button>
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

<style>
	.design-toolbar {
		display: flex;
		height: 36px;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		overflow-x: auto;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 12px;
		background: color-mix(in srgb, var(--bg-page) 88%, var(--bg-elevated));
		color: var(--text-secondary);
		scrollbar-width: none;
	}

	.design-toolbar::-webkit-scrollbar {
		display: none;
	}

	.toolbar-brand,
	.toolbar-controls,
	.toolbar-field {
		display: flex;
		flex: none;
		align-items: center;
	}

	.toolbar-brand {
		gap: 8px;
	}

	.toolbar-brand strong {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--text-muted);
	}

	.toolbar-brand span {
		color: var(--text-muted);
		font-family: var(--font-mono-family);
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.toolbar-controls {
		gap: 10px;
	}

	.toolbar-field {
		gap: 6px;
		color: var(--text-muted);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.toolbar-select {
		-webkit-appearance: none;
		appearance: none;
		display: inline-flex;
		height: 26px;
		min-width: 104px;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		border: 0;
		outline: none;
		border-radius: 5px;
		padding: 0 8px;
		background-color: var(--bg-elevated);
		background-image: none;
		box-shadow: none;
		color: var(--text-primary);
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		cursor: pointer;
	}

	.toolbar-select__value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar-select:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
	}

	@media (max-width: 560px) {
		.toolbar-brand span,
		.toolbar-field > span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
		}
	}
</style>

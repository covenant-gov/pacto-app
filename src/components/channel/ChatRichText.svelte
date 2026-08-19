<script lang="ts">
	import { t } from 'svelte-i18n';

	type TextToken =
		| { kind: 'text'; value: string }
		| { kind: 'mention'; value: string }
		| { kind: 'channel'; value: string }
		| { kind: 'proposal'; value: string };

	let {
		text,
		proposalTitleFor,
	}: {
		text: string;
		proposalTitleFor?: (token: string) => string | undefined;
	} = $props();

	function tokenize(value: string): TextToken[] {
		const tokens: TextToken[] = [];
		const pattern = /(@[\w.-]+|#\d+|#[\w-]+)/g;
		let last = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(value)) !== null) {
			if (match.index > last) {
				tokens.push({ kind: 'text', value: value.slice(last, match.index) });
			}
			const token = match[0];
			if (token.startsWith('@')) tokens.push({ kind: 'mention', value: token });
			else if (/^#\d+$/.test(token)) tokens.push({ kind: 'proposal', value: token });
			else tokens.push({ kind: 'channel', value: token });
			last = match.index + token.length;
		}
		if (last < value.length) tokens.push({ kind: 'text', value: value.slice(last) });
		return tokens;
	}

	const tokens = $derived(tokenize(text));
</script>

{#each tokens as token, i (i)}
	{#if token.kind === 'mention'}
		<span
			class="inline-flex items-center rounded-sm bg-primary/22 px-1.5 py-px font-medium whitespace-nowrap text-mention-accent"
		>
			{token.value}
		</span>
	{:else if token.kind === 'channel'}
		<span
			class="inline-flex items-center rounded-sm bg-accent/90 px-1.5 py-px font-medium whitespace-nowrap text-foreground"
		>
			{token.value}
		</span>
	{:else if token.kind === 'proposal'}
		{@const title = proposalTitleFor?.(token.value) ?? $t('design.chat.proposalFallback')}
		<span
			class="inline-flex max-w-[min(100%,20rem)] items-center gap-1 rounded-sm bg-warning/14 px-1.5 py-px font-medium text-warning shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--warning)_28%,transparent)]"
		>
			<span class="shrink-0 font-semibold tabular-nums opacity-80">{token.value}</span>
			<span class="min-w-0 truncate">{title}</span>
		</span>
	{:else}
		{token.value}
	{/if}
{/each}

import type { ShellChannel, ShellPreviewState } from './types';

const PREVIEW_STATES = new Set<ShellPreviewState>([
	'default',
	'loading',
	'empty',
	'error',
	'dense',
	'long',
]);

export function parseShellPreviewState(value: string | null): ShellPreviewState {
	return value !== null && PREVIEW_STATES.has(value as ShellPreviewState)
		? (value as ShellPreviewState)
		: 'default';
}

export function filterShellChannels(
	channels: readonly ShellChannel[],
	query: string,
): readonly ShellChannel[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return channels;
	return channels.filter((channel) => channel.name.toLocaleLowerCase().includes(normalized));
}

export function groupShellChannels(
	channels: readonly ShellChannel[],
): Array<{ id: string; label: string; channels: ShellChannel[] }> {
	const groups = new Map<string, { id: string; label: string; channels: ShellChannel[] }>();

	for (const channel of channels) {
		const existing = groups.get(channel.groupId);
		if (existing) {
			existing.channels.push(channel);
			continue;
		}
		groups.set(channel.groupId, {
			id: channel.groupId,
			label: channel.groupLabel,
			channels: [channel],
		});
	}

	return [...groups.values()];
}

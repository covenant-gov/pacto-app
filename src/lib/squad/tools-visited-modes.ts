import type { SquadToolsChannelMode } from '../../stores/navigation';

/** Ensure active mode and any pending deep-link panes are kept alive. */
export function withPendingToolsFocusModes(
  visited: Iterable<SquadToolsChannelMode>,
  activeMode: SquadToolsChannelMode,
  opts: { seedEvents?: boolean; seedDocs?: boolean } = {},
): Set<SquadToolsChannelMode> {
  const next = new Set(visited);
  next.add(activeMode);
  if (opts.seedEvents) next.add('events');
  if (opts.seedDocs) next.add('docs');
  return next;
}

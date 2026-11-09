import type { SquadBoardChannelMode } from '../../stores/navigation';

/** Ensure active mode and any pending deep-link panes are kept alive. */
export function withPendingBoardFocusModes(
  visited: Iterable<SquadBoardChannelMode>,
  activeMode: SquadBoardChannelMode,
  opts: { seedEvents?: boolean; seedDocs?: boolean } = {},
): Set<SquadBoardChannelMode> {
  const next = new Set(visited);
  next.add(activeMode);
  if (opts.seedEvents) next.add('events');
  if (opts.seedDocs) next.add('docs');
  return next;
}

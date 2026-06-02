import type { CommonsBroadcastDto, CommonsBroadcastLocalState } from './types';
import { persistenceKey } from '../../stores/persistence-context';

export const PACTO_COMMONS_BROADCASTS_PREFIX = 'pacto_commons_broadcasts';

type LocalBroadcastMap = Record<string, CommonsBroadcastLocalState>;

function mapKey(subject: string, subjectId: string): string {
  return `${subject}:${subjectId}`;
}

function readMap(): LocalBroadcastMap {
  if (typeof localStorage === 'undefined') return {};
  const key = persistenceKey(PACTO_COMMONS_BROADCASTS_PREFIX);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LocalBroadcastMap)
      : {};
  } catch {
    return {};
  }
}

function writeMap(map: LocalBroadcastMap): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_COMMONS_BROADCASTS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

export function localStateFromDto(dto: CommonsBroadcastDto): CommonsBroadcastLocalState {
  return {
    subject: dto.subject,
    subjectId: dto.subjectId,
    eventId: dto.eventId,
    expiresAt: dto.expiresAt,
    durationHours: dto.durationHours,
    tags: dto.tags,
    message: dto.message,
    audience: dto.audience ?? undefined,
  };
}

export function recordCommonsBroadcastLocalState(dto: CommonsBroadcastDto): void {
  const state = localStateFromDto(dto);
  const map = readMap();
  map[mapKey(state.subject, state.subjectId)] = state;
  writeMap(map);
}

export function clearCommonsBroadcastLocalState(subject: string, subjectId: string): void {
  const map = readMap();
  const key = mapKey(subject, subjectId);
  if (!(key in map)) return;
  delete map[key];
  writeMap(map);
}

export function getActiveCommonsBroadcastLocalState(
  subject: 'user' | 'squad',
  subjectId: string,
  nowSecs = Math.floor(Date.now() / 1000)
): CommonsBroadcastLocalState | null {
  const state = readMap()[mapKey(subject, subjectId)];
  if (!state || state.expiresAt <= nowSecs) return null;
  return state;
}

/**
 * Dashboard polls (per squad/network parent): list + tallies come from the Tauri SQLite replica
 * (`list_dashboard_polls`); localStorage here only stores the signed-in user’s last selected option
 * hint per poll (`getPollBallot` / `setPollBallot`).
 */

export type ParentPollOption = {
  id: string;
  label: string;
  votes: number;
};

export type ParentPoll = {
  id: string;
  parentId: string;
  title: string;
  description: string;
  options: ParentPollOption[];
  createdAtMs: number;
};

const STORAGE_VERSION = 'v1';

function key(viewerNpub: string, parentId: string): string {
  return `pacto_parent_polls_${STORAGE_VERSION}_${viewerNpub}_${parentId}`;
}

export function loadParentPolls(viewerNpub: string, parentId: string): ParentPoll[] {
  if (typeof localStorage === 'undefined' || !viewerNpub?.trim() || !parentId?.trim()) return [];
  try {
    const raw = localStorage.getItem(key(viewerNpub, parentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isParentPoll)
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch {
    return [];
  }
}

export function saveParentPolls(viewerNpub: string, parentId: string, polls: ParentPoll[]): void {
  if (typeof localStorage === 'undefined' || !viewerNpub?.trim() || !parentId?.trim()) return;
  try {
    localStorage.setItem(key(viewerNpub, parentId), JSON.stringify(polls));
  } catch {
    /* ignore quota */
  }
}

export function addParentPoll(viewerNpub: string, parentId: string, poll: ParentPoll): void {
  const list = loadParentPolls(viewerNpub, parentId);
  list.push(poll);
  saveParentPolls(viewerNpub, parentId, list);
}

export function updateParentPoll(
  viewerNpub: string,
  parentId: string,
  pollId: string,
  updater: (p: ParentPoll) => ParentPoll
): void {
  const list = loadParentPolls(viewerNpub, parentId);
  const i = list.findIndex((p) => p.id === pollId);
  if (i < 0) return;
  list[i] = updater(list[i]);
  saveParentPolls(viewerNpub, parentId, list);
}

/** Stable token others can paste in chat: `dashboard-poll:<id>` */
export function pollReferenceToken(pollId: string): string {
  return `dashboard-poll:${pollId.trim()}`;
}

type BallotMap = Record<string, string>;

function ballotKey(viewerNpub: string, parentId: string): string {
  return `pacto_parent_poll_ballots_${STORAGE_VERSION}_${viewerNpub}_${parentId}`;
}

function loadBallots(viewerNpub: string, parentId: string): BallotMap {
  if (typeof localStorage === 'undefined' || !viewerNpub?.trim() || !parentId?.trim()) return {};
  try {
    const raw = localStorage.getItem(ballotKey(viewerNpub, parentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const m: BallotMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string') m[k] = v;
    }
    return m;
  } catch {
    return {};
  }
}

function saveBallots(viewerNpub: string, parentId: string, map: BallotMap): void {
  if (typeof localStorage === 'undefined' || !viewerNpub?.trim() || !parentId?.trim()) return;
  try {
    localStorage.setItem(ballotKey(viewerNpub, parentId), JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function getPollBallotMap(viewerNpub: string, parentId: string): BallotMap {
  return { ...loadBallots(viewerNpub, parentId) };
}

export function getPollBallot(viewerNpub: string, parentId: string, pollId: string): string | null {
  return loadBallots(viewerNpub, parentId)[pollId] ?? null;
}

export function setPollBallot(
  viewerNpub: string,
  parentId: string,
  pollId: string,
  optionId: string
): void {
  const m = loadBallots(viewerNpub, parentId);
  m[pollId] = optionId;
  saveBallots(viewerNpub, parentId, m);
}

function isParentPoll(x: unknown): x is ParentPoll {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.parentId !== 'string') return false;
  if (typeof o.title !== 'string' || typeof o.description !== 'string') return false;
  if (typeof o.createdAtMs !== 'number') return false;
  if (!Array.isArray(o.options)) return false;
  for (const opt of o.options) {
    if (!opt || typeof opt !== 'object') return false;
    const op = opt as Record<string, unknown>;
    if (typeof op.id !== 'string' || typeof op.label !== 'string' || typeof op.votes !== 'number')
      return false;
  }
  return true;
}

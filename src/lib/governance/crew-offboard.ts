import { PRODUCTION_QUORUM_BPS } from './squad-params';
import type { CrewOffboardDto, QuartermasterStatusDto } from './api';

export function parseQuorumBps(
  raw: string | number | null | undefined,
  fallback = PRODUCTION_QUORUM_BPS,
): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** `QUORUM_OF_CAST`: turnout meets bps of snapshot and yeas > nays. */
export function quorumOfCastPassed(
  yeas: number,
  nays: number,
  snapshot: number,
  quorumBps: number,
): boolean {
  if (snapshot <= 0 || quorumBps <= 0 || yeas < 0 || nays < 0) return false;
  if (yeas <= nays) return false;
  return BigInt(yeas + nays) * 10_000n >= BigInt(quorumBps) * BigInt(snapshot);
}

export function isCrewOffboardActive(
  status: QuartermasterStatusDto | CrewOffboardDto | null | undefined,
): boolean {
  if (!status) return false;
  if ('activeCrewOffboardId' in status) {
    const id = status.activeCrewOffboardId?.trim() ?? '0';
    return id !== '0' && !status.offboard?.executed;
  }
  return status.offboardId.trim() !== '0' && !status.executed;
}

export function isCrewOffboardPastDeadline(
  offboard: CrewOffboardDto | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!offboard || offboard.executed || offboard.offboardId.trim() === '0') return false;
  return offboard.deadline > 0 && nowSec >= offboard.deadline;
}

export function isCrewOffboardExecutable(
  offboard: CrewOffboardDto | null | undefined,
  quorumBps: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!offboard || offboard.executed || offboard.offboardId.trim() === '0') return false;
  if (isCrewOffboardPastDeadline(offboard, nowSec)) return false;
  return quorumOfCastPassed(offboard.yeas, offboard.nays, offboard.snapshot, quorumBps);
}

export function isCrewOffboardExpirable(
  offboard: CrewOffboardDto | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  return isCrewOffboardPastDeadline(offboard, nowSec);
}

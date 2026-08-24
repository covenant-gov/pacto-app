import { get, writable } from 'svelte/store';

export type OnChainJobStatus = 'pending' | 'confirmed' | 'failed';

export interface OnChainJob {
  id: string;
  label: string;
  parentId?: string;
  actionKey?: string;
  status: OnChainJobStatus;
  startedAt: number;
  txHash?: string;
}

export const ON_CHAIN_JOB_SETTLE_MS = 3_000;

export const pendingOnChainJobs = writable<OnChainJob[]>([]);

const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
let nextJobSeq = 0;

function newJobId(): string {
  nextJobSeq += 1;
  return `onchain-${nextJobSeq}`;
}

function scheduleRemove(id: string): void {
  const prev = settleTimers.get(id);
  if (prev) clearTimeout(prev);
  settleTimers.set(
    id,
    setTimeout(() => {
      pendingOnChainJobs.update((jobs) => jobs.filter((j) => j.id !== id));
      settleTimers.delete(id);
    }, ON_CHAIN_JOB_SETTLE_MS),
  );
}

export function beginOnChainJob(opts: {
  label: string;
  parentId?: string;
  actionKey?: string;
  txHash?: string;
}): string {
  const id = newJobId();
  pendingOnChainJobs.update((jobs) => [
    ...jobs,
    {
      id,
      label: opts.label,
      parentId: opts.parentId,
      actionKey: opts.actionKey,
      status: 'pending',
      startedAt: Date.now(),
      txHash: opts.txHash,
    },
  ]);
  return id;
}

function setJobStatus(id: string, status: 'confirmed' | 'failed', txHash?: string): void {
  pendingOnChainJobs.update((jobs) =>
    jobs.map((j) => (j.id === id ? { ...j, status, txHash: txHash ?? j.txHash } : j)),
  );
  scheduleRemove(id);
}

export function completeOnChainJob(id: string, txHash?: string): void {
  setJobStatus(id, 'confirmed', txHash);
}

export function failOnChainJob(id: string): void {
  setJobStatus(id, 'failed');
}

/** True while a matching job is still awaiting receipt. */
export function hasPendingJob(parentId: string, actionKey: string): boolean {
  const pid = parentId.trim();
  const key = actionKey.trim();
  if (!pid || !key) return false;
  return get(pendingOnChainJobs).some(
    (j) => j.status === 'pending' && j.parentId === pid && j.actionKey === key,
  );
}

export function clearOnChainJobs(): void {
  for (const timer of settleTimers.values()) clearTimeout(timer);
  settleTimers.clear();
  pendingOnChainJobs.set([]);
}

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { showGovWriteErrorToast } from './gov-write-errors';
import { fundedByFromWriteResult, govWriteConfirmedToast } from './gov-write-funding';
import { hasPendingJob } from '../../stores/pending-on-chain';
import { showToast } from '../../stores/toast';

export function runGovWriteInBackground(opts: {
  label: string;
  parentId: string;
  actionKey?: string;
  job: () => Promise<unknown>;
  onSettled?: () => void | Promise<void>;
}): boolean {
  const actionKey = opts.actionKey?.trim();
  if (actionKey && hasPendingJob(opts.parentId, actionKey)) return false;
  const tFn = get(t);
  runOnChainInBackground({
    jobLabel: opts.label,
    parentId: opts.parentId,
    actionKey,
    startedToast: tFn('governance.toast.squadTransactionSubmitted'),
    errorToast: false,
    job: opts.job,
    onSuccess: async (result) => {
      showToast(govWriteConfirmedToast(opts.label, fundedByFromWriteResult(result)));
      await Promise.resolve(opts.onSettled?.());
    },
    onError: (_message, cause) => {
      showGovWriteErrorToast(cause ?? _message, opts.label);
      return true;
    },
  });
  return true;
}

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { getInvokeErrorMessage } from '../utils/tauri-errors';

const CODE_TO_I18N: Record<string, string> = {
  SPONSOR_POOL_LOW: 'governance.error.sponsorPoolLow',
  SPONSOR_INELIGIBLE: 'governance.error.sponsorIneligible',
  SPONSOR_PATH_UNAVAILABLE: 'governance.error.sponsorPathUnavailable',
  SPONSOR_REQUIRED: 'governance.error.sponsorRequired',
  SPONSOR_CONFIG: 'governance.error.sponsorConfig',
  SPONSOR_PAYMASTER_MISMATCH: 'governance.error.sponsorPaymasterMismatch',
  SPONSOR_LOOKUP: 'governance.error.sponsorUnavailable',
  SPONSOR_READ: 'governance.error.sponsorUnavailable',
  SPONSOR_REGISTRY: 'governance.error.sponsorUnavailable',
  SPONSOR_BALANCE: 'governance.error.sponsorUnavailable',
  SPONSOR_OR_PACTO_GOV_REQUIRED: 'governance.error.sponsorRequired',
  PAYMASTER_REJECTED: 'governance.error.paymasterRejected',
  PAYMASTER_DEPOSIT_LOW: 'governance.error.paymasterDepositLow',
  PAYMASTER_DEPOSIT_READ: 'governance.error.paymasterDepositLow',
  PAYMASTER_STAKE_LOW: 'governance.error.paymasterStakeLow',
  PAYMASTER_VALIDATION: 'governance.error.paymasterValidation',
  PAYMASTER_VERIFICATION_GAS: 'governance.error.paymasterOperator',
  PAYMASTER_GAS_EFFICIENCY: 'governance.error.paymasterOperator',
  PAYMASTER_DATA: 'governance.error.paymasterOperator',
};

/** Extract wallet_err_json `code` when present. */
export function parseWalletErrorCode(e: unknown): string | null {
  const candidates: string[] = [];
  if (typeof e === 'string') candidates.push(e);
  else if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') candidates.push(obj.message);
    if (typeof obj.error === 'string') candidates.push(obj.error);
    if (typeof obj.code === 'string') return obj.code.trim() || null;
    const data = obj.data as Record<string, unknown> | undefined;
    if (data && typeof data.message === 'string') candidates.push(data.message);
    if (data && typeof data.code === 'string') return data.code.trim() || null;
    if (e instanceof Error && e.message) candidates.push(e.message);
  }
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { code?: unknown };
      if (typeof parsed.code === 'string' && parsed.code.trim()) return parsed.code.trim();
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/** Member-safe gov-write error; maps SPONSOR_/PAYMASTER_ codes to i18n. */
export function govWriteErrorMessage(e: unknown, fallbackLabel: string): string {
  const code = parseWalletErrorCode(e);
  if (code) {
    const key = CODE_TO_I18N[code];
    if (key) return get(t)(key);
  }
  return getInvokeErrorMessage(e, get(t)('governance.toast.failed', { values: { label: fallbackLabel } }));
}

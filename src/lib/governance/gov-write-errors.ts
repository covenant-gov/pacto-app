import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { showToast } from '../../stores/toast';
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
  USEROP_CALL_GAS: 'governance.error.useropCallGas',
  USEROP_CALL_REVERTED: 'governance.error.useropCallReverted',
  GOV_CALL_REVERTED: 'governance.error.govCallReverted',
  MUTINY_NOT_ACTIVE: 'governance.error.mutinyNotActive',
  MUTINY_NOT_EXPIRED: 'governance.error.mutinyNotExpired',
  MUTINY_EXPIRED: 'governance.error.mutinyExpired',
  SEND_FAILED: 'governance.error.govCallReverted',
  USEROP_FAILED: 'governance.error.govCallReverted',
  TX_REVERTED: 'governance.error.govCallReverted',
  ACL_UNBOUND: 'governance.error.aclUnbound',
  ACL_DENIED: 'governance.error.aclDenied',
};

const REVERT_SELECTOR_TO_CODE: Record<string, string> = {
  '0xc4aedfdd': 'MUTINY_NOT_ACTIVE',
  '0x06dc7f6f': 'MUTINY_NOT_EXPIRED',
  '0x42af4065': 'MUTINY_EXPIRED',
};

function errorBlob(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const parts = [obj.message, obj.error, obj.code]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (parts) return parts;
    if (e instanceof Error) return e.message;
  }
  return '';
}

/** Known pacto-gov revert selector or error name → wallet code. */
export function revertCodeFromError(e: unknown): string | null {
  const raw = errorBlob(e).toLowerCase();
  if (raw.includes('mutinymodule_noactivemutiny')) return 'MUTINY_NOT_ACTIVE';
  if (raw.includes('mutinymodule_notexpired')) return 'MUTINY_NOT_EXPIRED';
  if (raw.includes('mutinymodule_expired')) return 'MUTINY_EXPIRED';
  const match = raw.match(/0x([0-9a-f]{8})/);
  if (!match) return null;
  return REVERT_SELECTOR_TO_CODE[`0x${match[1]}`] ?? null;
}

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

/** Member-safe gov-write error; maps SPONSOR_/PAYMASTER_/ACL_ codes to i18n. */
export function govWriteErrorMessage(e: unknown, fallbackLabel: string): string {
  const fromRevert = revertCodeFromError(e);
  if (fromRevert) {
    const key = CODE_TO_I18N[fromRevert];
    if (key) return get(t)(key);
  }
  const code = parseWalletErrorCode(e);
  if (code) {
    const key = CODE_TO_I18N[code];
    if (key) return get(t)(key);
  }
  return getInvokeErrorMessage(e, get(t)('governance.toast.failed', { values: { label: fallbackLabel } }));
}

/** Gov-write failure toast; always uses error styling. */
export function showGovWriteErrorToast(e: unknown, fallbackLabel: string): void {
  showToast(govWriteErrorMessage(e, fallbackLabel), undefined, undefined, { error: true });
}

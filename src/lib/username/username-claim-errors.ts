import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { parseWalletErrorCode } from '../governance/gov-write-errors';

const CODE_TO_I18N: Record<string, string> = {
  USERNAME_CLAIM_REVERTED: 'profile.username.errors.claimReverted',
  USERNAME_BINDING_EXPIRED: 'profile.username.errors.bindingExpired',
  USERNAME_INVALID_NAME: 'profile.username.errors.invalidName',
  USERNAME_TAKEN: 'profile.username.errors.taken',
  USERNAME_NPUB_CLAIMED: 'profile.username.errors.npubClaimed',
  ALREADY_CLAIMED: 'profile.username.errors.alreadyClaimed',
  USERNAME_INVALID_EVM_SIG: 'profile.username.errors.invalidEvmSig',
  USERNAME_INVALID_NPUB_HASH: 'profile.username.errors.invalidNpubHash',
  USERNAME_INVALID_NOSTR_SIG: 'profile.username.errors.invalidNostrSig',
  USERNAME_NONCE_USED: 'profile.username.errors.nonceUsed',
  USERNAME_7702_SENDER: 'profile.username.errors.stale7702',
  USERNAME_7702_MISMATCH: 'profile.username.errors.paymaster7702Mismatch',
  USERNAME_PATH_UNAVAILABLE: 'profile.username.errors.noGasPath',
  BUNDLER_CONFIG: 'profile.username.errors.bundlerConfig',
  USEROP_FAILED: 'profile.username.errors.userOpFailed',
  BOOTSTRAP_AFTER_MINT: 'profile.username.errors.bootstrapAfterMint',
  USERNAME_POOL_LOW: 'profile.username.errors.poolLow',
};

/** Map username claim / sponsor wallet errors to profile i18n. */
export function usernameClaimErrorMessage(e: unknown, fallback?: string): string {
  const tFn = get(t);
  const code = parseWalletErrorCode(e);
  if (code) {
    const key = CODE_TO_I18N[code];
    if (key) return tFn(key);
  }
  const raw = getInvokeErrorMessage(e, fallback ?? tFn('errors.fallback'));
  if (raw.includes('USERNAME_BINDING_EXPIRED') || raw.includes('BindingExpired')) {
    return tFn('profile.username.errors.bindingExpired');
  }
  if (raw.includes('BUNDLER_CONFIG') || raw.includes('Pimlico')) {
    return tFn('profile.username.errors.bundlerConfig');
  }
  if (raw.includes('USERNAME_PATH_UNAVAILABLE') || raw.includes('no gas path')) {
    return tFn('profile.username.errors.noGasPath');
  }
  if (raw.includes('USERNAME_7702')) {
    return tFn('profile.username.errors.stale7702');
  }
  if (raw.includes('USERNAME_CLAIM_REVERTED') || raw.includes('eth_call reverted')) {
    return tFn('profile.username.errors.claimReverted');
  }
  return raw;
}

import { getAddress, isAddress, parseEther } from 'viem';
import type { SupportedChainId } from './chains';
import { getEvmNativeBalance } from './backend-wallet';

/** Gas/deposit payer balance shown in sponsor deploy and treasury UIs. */
export type SignerBalance = {
  balanceRaw: string;
  balanceDecimal: string;
  symbol: string;
  loading: boolean;
  error: string;
};

export function emptyBalance(): SignerBalance {
  return { balanceRaw: '0', balanceDecimal: '0', symbol: 'ETH', loading: false, error: '' };
}

/** Idle row used while a native balance RPC is in flight. */
export function loadingBalance(): SignerBalance {
  return { balanceRaw: '0', balanceDecimal: '0', symbol: 'ETH', loading: true, error: '' };
}

/** Checksums a valid EVM address; anything else becomes null. */
export function canonicalAddress(addr: string | null | undefined): string | null {
  if (!addr?.trim() || !isAddress(addr.trim() as `0x${string}`)) return null;
  try {
    return getAddress(addr.trim() as `0x${string}`);
  } catch {
    return null;
  }
}

export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return 'Not set';
  const t = addr.trim();
  if (t.length < 16) return t;
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

/** True when the ETH amount leaves no room for gas against the wei balance. */
export function amountExceedsBalance(amountTrimmed: string, balanceRaw: string): boolean {
  try {
    if (!/^\d+$/.test(balanceRaw.trim())) return false;
    const amt = parseEther(amountTrimmed.replace(/,/g, ''));
    return amt >= BigInt(balanceRaw.trim());
  } catch {
    return false;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
    ms,
  );
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

/** Native balance for one signer; failures land in `error` instead of throwing. */
export async function fetchEvmBalance(
  network: SupportedChainId | '' | null | undefined,
  address: string | null,
  opts?: { timeoutMs?: number },
): Promise<SignerBalance> {
  if (!address) return emptyBalance();
  if (!network) {
    return { ...emptyBalance(), error: 'Squad network not set' };
  }
  try {
    const pending = getEvmNativeBalance(network, address);
    const result = opts?.timeoutMs
      ? await withTimeout(pending, opts.timeoutMs, 'Balance lookup')
      : await pending;
    if (result.ok) {
      return {
        balanceRaw: result.balance.balanceRaw,
        balanceDecimal: result.balance.balanceDecimal,
        symbol: result.balance.symbol,
        loading: false,
        error: '',
      };
    }
    return { ...emptyBalance(), loading: false, error: result.message };
  } catch (e) {
    return {
      ...emptyBalance(),
      loading: false,
      error: e instanceof Error ? e.message : 'Balance lookup failed',
    };
  }
}

/** Payer choice after Default/squad signer addresses (re)load. */
export function reconcileSignerWallet(
  current: 'default' | 'squad',
  defaultSignerAddress: string | null,
  squadSignerAddress: string | null,
): 'default' | 'squad' {
  const defaultCanon = canonicalAddress(defaultSignerAddress);
  const squadCanon = canonicalAddress(squadSignerAddress);
  if (defaultCanon && squadCanon && defaultCanon === squadCanon) return 'squad';
  if (current === 'default' && !defaultSignerAddress && squadSignerAddress) return 'squad';
  if (current === 'squad' && !squadSignerAddress && defaultSignerAddress) return 'default';
  return current;
}

/** Prefer Default as payer when the roster signer is unfunded and Default is not. */
export function shouldPreferFundedDefault(params: {
  defaultSignerAddress: string | null;
  squadSignerAddress: string | null;
  defaultBalanceRaw: string;
  squadBalanceRaw: string;
}): boolean {
  const def = canonicalAddress(params.defaultSignerAddress);
  const squad = canonicalAddress(params.squadSignerAddress);
  if (!def || !squad || def === squad) return false;
  try {
    return (
      BigInt(params.squadBalanceRaw || '0') === 0n && BigInt(params.defaultBalanceRaw || '0') > 0n
    );
  } catch {
    return false;
  }
}

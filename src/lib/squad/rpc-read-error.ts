export type RpcReadErrorKind = 'rate_limited' | 'unreachable';

function flattenErrorText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; message?: unknown };
    const parts = [parsed.code, parsed.message].filter((v): v is string => typeof v === 'string');
    if (parts.length) return `${trimmed} ${parts.join(' ')}`;
  } catch {
    /* keep raw */
  }
  return trimmed;
}

/** Classify JSON-RPC / HTTP transport failures. Other chain errors stay untyped. */
export function rpcReadErrorKind(raw: string | null | undefined): RpcReadErrorKind | null {
  if (!raw?.trim()) return null;
  const lower = flattenErrorText(raw).toLowerCase();
  if (/\b429\b/.test(lower) || lower.includes('rate limit') || lower.includes('-32005')) {
    return 'rate_limited';
  }
  if (
    lower.includes('rpc_connect') ||
    lower.includes('rpc connect timeout') ||
    /tried \d+ url\(s\)/.test(lower)
  ) {
    return 'unreachable';
  }
  return null;
}

/** At most one card per transport kind across parallel dashboard reads. */
export function uniqueRpcReadErrorKinds(
  ...rawErrors: (string | null | undefined)[]
): RpcReadErrorKind[] {
  const seen = new Set<RpcReadErrorKind>();
  const kinds: RpcReadErrorKind[] = [];
  for (const raw of rawErrors) {
    const kind = rpcReadErrorKind(raw);
    if (kind && !seen.has(kind)) {
      seen.add(kind);
      kinds.push(kind);
    }
  }
  return kinds;
}

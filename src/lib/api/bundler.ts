import { invoke } from './index';

export type BundlerStatusSource = 'pimlico' | 'none' | 'blocked_alchemy_override';

export type BundlerStatusDto = {
  source: BundlerStatusSource;
  hasStoredKey: boolean;
};

export type PimlicoKeyClassifyError = 'empty' | 'url';

function parseBundlerStatusSource(raw: unknown): BundlerStatusSource {
  if (raw === 'pimlico' || raw === 'none' || raw === 'blocked_alchemy_override') return raw;
  return 'none';
}

/** Reject empty keys and pasted URLs (including Alchemy hosts). Never echo the value. */
export function classifyPimlicoApiKey(
  raw: string,
): { ok: true; key: string } | { ok: false; error: PimlicoKeyClassifyError } {
  const key = raw.trim();
  if (!key || /\s/.test(key)) return { ok: false, error: 'empty' };
  const lower = key.toLowerCase();
  if (lower.includes('://') || lower.startsWith('http') || lower.includes('alchemy.com')) {
    return { ok: false, error: 'url' };
  }
  return { ok: true, key };
}

/** Backend: `get_bundler_status` — no URLs or keys. */
export async function getBundlerStatus(network: string): Promise<BundlerStatusDto> {
  const dto = await invoke<BundlerStatusDto>('get_bundler_status', { network });
  return {
    source: parseBundlerStatusSource(dto?.source),
    hasStoredKey: dto?.hasStoredKey === true,
  };
}

export async function setPimlicoApiKey(key: string): Promise<void> {
  await invoke('set_pimlico_api_key', { key });
}

export async function clearPimlicoApiKey(): Promise<void> {
  await invoke('clear_pimlico_api_key');
}

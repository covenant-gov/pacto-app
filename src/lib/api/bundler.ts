import { invoke } from './index';

export type BundlerStatusSource = 'pimlico' | 'none' | 'blocked_alchemy_override';

export type BundlerStatusDto = {
  source: BundlerStatusSource;
};

function parseBundlerStatusSource(raw: unknown): BundlerStatusSource {
  if (raw === 'pimlico' || raw === 'none' || raw === 'blocked_alchemy_override') return raw;
  return 'none';
}

/** Backend: `get_bundler_status` — no URLs or keys. */
export async function getBundlerStatus(network: string): Promise<BundlerStatusDto> {
  const dto = await invoke<BundlerStatusDto>('get_bundler_status', { network });
  return { source: parseBundlerStatusSource(dto?.source) };
}

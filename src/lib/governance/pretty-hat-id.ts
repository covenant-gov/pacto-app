/** Hats IP-style id: tree domain + non-zero 16-bit levels (e.g. `15.2.5.10.1`). */

const TOPHAT_BITS = 32n;
const LEVEL_BITS = 16n;
const MAX_LEVELS = 14;
const TOPHAT_SHIFT = 256n - TOPHAT_BITS; // 224
const TOPHAT_DOMAIN_MASK = (1n << TOPHAT_BITS) - 1n;

function parseHatIdBigInt(raw: string): bigint | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
    if (/^[0-9]+$/.test(s)) return BigInt(s);
    return null;
  } catch {
    return null;
  }
}

/**
 * Tree id for `app.hatsprotocol.xyz/trees/{chainId}/{treeId}`.
 * Accepts a bare domain (`950`) or a full uint256 hat id (uses the high 32 bits).
 */
export function hatsTreeDomain(raw: string): string | null {
  const id = parseHatIdBigInt(raw);
  if (id === null) return null;
  // Bare domain from deploy/storage — not a packed hat bitmap.
  if (id <= TOPHAT_DOMAIN_MASK) return id.toString(10);
  return ((id >> TOPHAT_SHIFT) & TOPHAT_DOMAIN_MASK).toString(10);
}

/**
 * Full uint256 hat id as `0x` + 64 hex chars (bare domains are packed as top hats).
 */
export function hatIdToHex(raw: string): string | null {
  const id = parseHatIdBigInt(raw);
  if (id === null) return null;
  const packed = id <= TOPHAT_DOMAIN_MASK ? id << TOPHAT_SHIFT : id;
  return `0x${packed.toString(16).padStart(64, '0')}`;
}

/**
 * Convert a raw Hats uint256 (decimal or hex) to pretty dotted form.
 * Returns null when the input cannot be parsed.
 */
export function prettyHatId(raw: string): string | null {
  const id = parseHatIdBigInt(raw);
  if (id === null) return null;

  // Bare tree domain (not a full hat bitmap).
  if (id <= TOPHAT_DOMAIN_MASK) return id.toString(10);

  const tree = (id >> TOPHAT_SHIFT) & TOPHAT_DOMAIN_MASK;
  const parts: string[] = [tree.toString(10)];

  for (let i = 0; i < MAX_LEVELS; i++) {
    const shift = TOPHAT_SHIFT - LEVEL_BITS * BigInt(i + 1);
    const chunk = (id >> shift) & ((1n << LEVEL_BITS) - 1n);
    parts.push(chunk.toString(10));
  }

  while (parts.length > 1 && parts[parts.length - 1] === '0') {
    parts.pop();
  }
  return parts.join('.');
}

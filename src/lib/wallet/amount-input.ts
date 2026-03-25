/**
 * Wallet amount fields: keep a leading zero before the decimal point (never `.1`, always `0.1`).
 * Call on each input so typing/paste is corrected immediately.
 */
export function normalizeLeadingDotDecimalInput(raw: string): string {
  const m = raw.match(/^(\s*)\./);
  if (m) return `${m[1]}0${raw.slice(m[1].length)}`;
  return raw;
}

/**
 * DM flow debugging. Logs only when DEV or when DM_DEBUG is true (set to true to enable in production).
 */
export function dmLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log('[DM]', ...args);
}

export function dmWarn(...args: unknown[]) {
  if (import.meta.env.DEV) console.warn('[DM]', ...args);
}

export function dmError(...args: unknown[]) {
  console.error('[DM]', ...args);
}

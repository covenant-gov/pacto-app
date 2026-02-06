/**
 * DM flow debugging. Logs only when DEV or when DM_DEBUG is true (set to true to enable in production).
 */
const DM_DEBUG = import.meta.env.DEV;

export function dmLog(...args: unknown[]) {
  if (DM_DEBUG) console.log('[DM]', ...args);
}

export function dmWarn(...args: unknown[]) {
  if (DM_DEBUG) console.warn('[DM]', ...args);
}

export function dmError(...args: unknown[]) {
  console.error('[DM]', ...args);
}

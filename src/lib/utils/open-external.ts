/**
 * Open a URL in the system browser (Tauri) or new tab (browser).
 * Use for message/profile links so the app window does not navigate away.
 */
export async function openExternalUrl(href: string): Promise<void> {
  const url = href.trim().toLowerCase();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  try {
    if (typeof window !== 'undefined' && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(href);
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

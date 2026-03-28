/**
 * Best-effort OS notification (Web Notification in Tauri/webview). No permission prompt.
 */
export function notifyUserAction(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

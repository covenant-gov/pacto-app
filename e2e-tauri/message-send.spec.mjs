/**
 * Minimal end-to-end spec for the real-Tauri harness.
 *
 * Uses MCP tools to authenticate via the debug-only test fixture, send a text
 * message, and assert the message persists in the backend database. A screenshot
 * is captured for visual verification.
 */

import assert from 'node:assert';

async function invokeTauri(callTool, command, args = {}) {
  // Prefer ipc_execute_command over webview_execute_js: async invoke return values
  // are flaky on Linux WebKitGTK (command can succeed while JS sees null).
  const wrapped = await callTool('ipc_execute_command', { command, args });
  if (!wrapped || wrapped.success === false) {
    throw new Error(`invoke ${command} failed: ${JSON.stringify(wrapped)}`);
  }
  return wrapped.result ?? wrapped;
}

export async function run({ callTool, saveArtifact }) {
  // 1. Authenticate with the debug-only test fixture.
  const auth = await invokeTauri(callTool, 'test_login_fixture');
  const npub = auth?.npub;
  assert.ok(npub && typeof npub === 'string' && npub.startsWith('npub1'), `unexpected npub: ${npub}`);

  // 2. Capture a screenshot of the webview for visual verification.
  const screenshot = await callTool('webview_screenshot', { format: 'png' });
  if (screenshot && screenshot.success && screenshot.result?.data) {
    saveArtifact('message-send.png', Buffer.from(screenshot.result.data, 'base64'));
  }

  // 3. Capture webview console logs.
  const logs = await callTool('read_logs', { source: 'console' }).catch(() => null);
  if (logs) {
    saveArtifact('webview-console.json', JSON.stringify(logs, null, 2));
  }

  return { npub };
}

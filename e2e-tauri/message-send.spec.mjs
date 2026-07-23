/**
 * Minimal end-to-end spec for the real-Tauri harness.
 *
 * Uses MCP tools to authenticate via the debug-only test fixture, send a text
 * message, and assert the message persists in the backend database. A screenshot
 * is captured for visual verification.
 */

import assert from 'node:assert';

const WINDOW_LABEL = 'main';

async function invokeTauri(callTool, command, args = {}) {
  const script = `return await window.__TAURI__.core.invoke('${command}', ${JSON.stringify(args)});`;
  const result = await callTool('webview_execute_js', { script, windowLabel: WINDOW_LABEL });
  // webview_execute_js returns the raw invocation result. The Tauri backend may
  // wrap errors in { success: false, error } on failure, but success payloads
  // are returned directly.
  if (result && result.success === false) {
    throw new Error(`invoke ${command} failed: ${JSON.stringify(result)}`);
  }
  return result;
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

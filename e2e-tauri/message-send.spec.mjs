/**
 * Minimal end-to-end spec for the real-Tauri harness.
 *
 * Uses MCP tools to authenticate via the debug-only test fixture, send a text
 * message, and assert the message persists in the backend database. A screenshot
 * is captured for visual verification.
 */

import assert from 'node:assert';

const TEST_MESSAGE = 'hello from pacto e2e';
const WINDOW_LABEL = 'main';

async function invokeTauri(callTool, command, args = {}) {
  const script = `return await window.__TAURI__.core.invoke('${command}', ${JSON.stringify(args)});`;
  const result = await callTool('webview_execute_js', { script, windowLabel: WINDOW_LABEL });
  assert.ok(result && result.success, `invoke ${command} failed: ${JSON.stringify(result)}`);
  return result.data;
}

export async function run({ callTool, saveArtifact }) {
  // 1. Authenticate with the debug-only test fixture.
  const auth = await invokeTauri(callTool, 'test_login_fixture');
  const npub = auth?.npub;
  assert.ok(npub && typeof npub === 'string' && npub.startsWith('npub1'), `unexpected npub: ${npub}`);

  // 2. Send a text message to the fixture account (self-DM, which creates a chat).
  const sendResult = await invokeTauri(callTool, 'message', {
    receiver: npub,
    content: TEST_MESSAGE,
    replied_to: '',
  });
  assert.ok(sendResult === true, `message command returned: ${JSON.stringify(sendResult)}`);

  // 3. Verify the message appears in the database via the backend command.
  const messages = await invokeTauri(callTool, 'get_chat_messages_paginated', {
    chat_id: npub,
    limit: 10,
    offset: 0,
  });
  assert.ok(Array.isArray(messages?.messages), `unexpected messages shape: ${JSON.stringify(messages)}`);
  const found = messages.messages.some(m =>
    m.content?.includes(TEST_MESSAGE) || m.text?.includes(TEST_MESSAGE)
  );
  assert.ok(found, `message not found in database: ${JSON.stringify(messages.messages)}`);

  // 4. Capture a screenshot of the webview for visual verification.
  const screenshot = await callTool('webview_screenshot', { format: 'png' });
  if (screenshot && screenshot.success && screenshot.result?.data) {
    saveArtifact('message-send.png', Buffer.from(screenshot.result.data, 'base64'));
  }

  // 5. Capture webview console logs.
  const logs = await callTool('read_logs', { source: 'console' }).catch(() => null);
  if (logs) {
    saveArtifact('webview-console.json', JSON.stringify(logs, null, 2));
  }

  return { npub, message: TEST_MESSAGE };
}

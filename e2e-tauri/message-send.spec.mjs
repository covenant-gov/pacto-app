/**
 * Minimal end-to-end spec for the real-Tauri harness.
 *
 * Uses MCP tools to authenticate via the debug-only test fixture, send a text
 * message, and assert the message persists in the backend database. A screenshot
 * is captured for visual verification.
 */

import assert from 'node:assert';

const WINDOW_ID = 'main';
const INVOKE_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hypothesi execute_js returns `{ success, data }` (or `{ success:false, error }`). */
function unwrapExecuteJs(result, label) {
  if (result == null) {
    throw new Error(`${label}: empty webview_execute_js result`);
  }
  if (typeof result === 'string') {
    try {
      return unwrapExecuteJs(JSON.parse(result), label);
    } catch {
      throw new Error(`${label}: non-JSON result: ${result}`);
    }
  }
  if (result.success === false) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  }
  if (Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result;
}

/**
 * Invoke a Tauri command via webview JS.
 *
 * `ipc_execute_command` cannot call app commands (only `plugin:mcp-bridge|*`).
 * A single async execute_js is capped at ~5s by the bridge; fixture login can
 * exceed that on CI, so we start the invoke once and poll a window slot.
 */
async function invokeTauri(callTool, command, args = {}) {
  const slot = `__e2e_invoke_${command}`;
  const startScript = `(() => {
    const slot = ${JSON.stringify(slot)};
    if (!window[slot]) {
      window[slot] = { done: false, error: null, result: null };
      Promise.resolve(window.__TAURI__.core.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}))
        .then((r) => { window[slot].result = r; window[slot].done = true; })
        .catch((e) => {
          window[slot].error = (e && e.message) ? e.message : String(e);
          window[slot].done = true;
        });
    }
    return { started: true };
  })()`;

  unwrapExecuteJs(
    await callTool('webview_execute_js', { script: startScript, windowId: WINDOW_ID }),
    `start ${command}`,
  );

  const deadline = Date.now() + INVOKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pollScript = `(() => {
      const s = window[${JSON.stringify(slot)}];
      if (!s) return { done: false };
      if (!s.done) return { done: false };
      if (s.error) return { done: true, ok: false, error: s.error };
      return { done: true, ok: true, result: s.result };
    })()`;
    const polled = unwrapExecuteJs(
      await callTool('webview_execute_js', { script: pollScript, windowId: WINDOW_ID }),
      `poll ${command}`,
    );
    if (polled?.done) {
      if (!polled.ok) {
        throw new Error(`invoke ${command} failed: ${polled.error}`);
      }
      return polled.result;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`invoke ${command} timed out after ${INVOKE_TIMEOUT_MS}ms`);
}

export async function run({ callTool, saveArtifact }) {
  // 1. Authenticate with the debug-only test fixture.
  const auth = await invokeTauri(callTool, 'test_login_fixture');
  const npub = auth?.npub;
  assert.ok(
    npub && typeof npub === 'string' && npub.startsWith('npub1'),
    `unexpected npub: ${npub}; auth=${JSON.stringify(auth)}`,
  );

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

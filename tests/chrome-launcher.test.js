const test = require('node:test');
const assert = require('node:assert/strict');

const { ChromeLauncher } = require('../src/services/chrome-launcher');

test('ChromeLauncher constructor parses port from cdpEndpoint', () => {
  const launcher = new ChromeLauncher({ cdpEndpoint: 'http://127.0.0.1:9333' });
  assert.equal(launcher.port, 9333);
  assert.equal(launcher.host, '127.0.0.1');
});

test('ChromeLauncher constructor defaults to port 9222', () => {
  const launcher = new ChromeLauncher({});
  assert.equal(launcher.port, 9222);
  assert.equal(launcher.cdpEndpoint, 'http://127.0.0.1:9222');
});

test('ChromeLauncher isRunning returns true when Chrome responds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const launcher = new ChromeLauncher({});
    const result = await launcher.isRunning();
    assert.equal(result, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ChromeLauncher isRunning returns false when Chrome is unreachable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  try {
    const launcher = new ChromeLauncher({});
    const result = await launcher.isRunning();
    assert.equal(result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ChromeLauncher ensureRunning skips launch when already running', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const launcher = new ChromeLauncher({});
    const result = await launcher.ensureRunning();
    assert.equal(result.started, false);
    assert.equal(result.alreadyRunning, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

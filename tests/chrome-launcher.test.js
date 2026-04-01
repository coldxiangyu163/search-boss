const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');

const { ChromeLauncher, needsVirtualDisplay, findFreeDisplay, detectLinuxChromePath } = require('../src/services/chrome-launcher');

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

test('detectLinuxChromePath supports ungoogled-chromium path', () => {
  const originalAccessSync = fs.accessSync;
  try {
    fs.accessSync = (target) => {
      if (target === '/usr/bin/ungoogled-chromium') {
        return true;
      }
      throw new Error('not found');
    };
    assert.equal(detectLinuxChromePath(), '/usr/bin/ungoogled-chromium');
  } finally {
    fs.accessSync = originalAccessSync;
  }
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

test('needsVirtualDisplay returns false on non-linux', () => {
  if (os.platform() !== 'linux') {
    assert.equal(needsVirtualDisplay(), false);
  }
});

test('needsVirtualDisplay returns false when DISPLAY is set on linux', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(os, 'platform');
  const origDisplay = process.env.DISPLAY;
  try {
    os.platform = () => 'linux';
    process.env.DISPLAY = ':0';
    // needsVirtualDisplay checks os.platform() at module level,
    // but the function reads it at call time — so this works
    // only if we also patch at the right level. Since we exported
    // the function, we can test the logic directly.
    // On non-linux CI this will just confirm false.
    if (os.platform() === 'linux') {
      assert.equal(needsVirtualDisplay(), false);
    }
  } finally {
    if (origDisplay === undefined) {
      delete process.env.DISPLAY;
    } else {
      process.env.DISPLAY = origDisplay;
    }
    if (origPlatform) {
      Object.defineProperty(os, 'platform', origPlatform);
    }
  }
});

test('findFreeDisplay returns a number in expected range', () => {
  const display = findFreeDisplay(99, 199);
  assert.equal(typeof display, 'number');
  assert.ok(display >= 99 && display <= 199);
});

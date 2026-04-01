const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LINUX_CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/ungoogled-chromium',
  '/snap/bin/chromium',
  '/usr/lib/chromium/chromium',
  '/usr/lib/chromium-browser/chromium-browser',
  '/usr/lib64/ungoogled-chromium/ungoogled-chromium',
  '/opt/google/chrome/chrome',
  '/opt/google/chrome/google-chrome',
];

const LINUX_WHICH_NAMES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  'ungoogled-chromium',
];

function detectLinuxChromePath() {
  for (const candidate of LINUX_CHROME_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      console.log(`[chrome-launcher] Detected Linux browser: ${candidate}`);
      return candidate;
    } catch {}
  }

  for (const name of LINUX_WHICH_NAMES) {
    try {
      const resolved = execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      if (resolved) {
        console.log(`[chrome-launcher] Detected Linux browser via which: ${resolved}`);
        return resolved;
      }
    } catch {}
  }

  console.warn('[chrome-launcher] No Chrome/Chromium found on Linux, falling back to "google-chrome"');
  return 'google-chrome';
}

const DEFAULT_CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

function needsVirtualDisplay() {
  if (os.platform() !== 'linux') return false;
  if (process.env.DISPLAY) return false;
  return true;
}

function isXvfbInstalled() {
  try {
    execFileSync('which', ['Xvfb'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findFreeDisplay(start = 99, end = 199) {
  for (let n = start; n <= end; n++) {
    try {
      execFileSync('test', ['-e', `/tmp/.X11-unix/X${n}`], { stdio: 'ignore' });
    } catch {
      return n;
    }
  }
  return start;
}

class ChromeLauncher {
  constructor({ cdpEndpoint, chromePath, userDataDir, downloadDir } = {}) {
    this.cdpEndpoint = cdpEndpoint || 'http://127.0.0.1:9222';
    this.chromePath = chromePath || DEFAULT_CHROME_PATHS[os.platform()]
      || (os.platform() === 'linux' ? detectLinuxChromePath() : 'google-chrome');
    this.userDataDir = userDataDir || path.join(os.homedir(), '.chrome-boss-profile');
    this.downloadDir = downloadDir || path.join(os.homedir(), '.chrome-boss-downloads');
    this._process = null;
    this._xvfbProcess = null;

    const parsed = new URL(this.cdpEndpoint);
    this.host = parsed.hostname;
    this.port = Number(parsed.port) || 9222;
  }

  async isRunning() {
    try {
      const response = await fetch(`${this.cdpEndpoint}/json/version`, {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureRunning() {
    const running = await this.isRunning();
    if (running) {
      console.log(`[chrome-launcher] Chrome already running at ${this.cdpEndpoint}`);
      await this._ensureBossPage();
      return { started: false, alreadyRunning: true };
    }

    console.log(`[chrome-launcher] Chrome not detected at ${this.cdpEndpoint}, starting...`);
    this._ensureDisplay();
    return this._launch();
  }

  _ensureDisplay() {
    if (!needsVirtualDisplay()) {
      if (os.platform() === 'linux' && process.env.DISPLAY) {
        console.log(`[chrome-launcher] DISPLAY=${process.env.DISPLAY}, skipping Xvfb`);
      }
      return;
    }

    if (!isXvfbInstalled()) {
      console.warn('[chrome-launcher] No DISPLAY and Xvfb not installed — Chrome may fail to start');
      console.warn('[chrome-launcher] Install with: sudo apt install -y xvfb');
      return;
    }

    const displayNum = findFreeDisplay();
    const display = `:${displayNum}`;
    console.log(`[chrome-launcher] No DISPLAY detected, starting Xvfb on ${display}`);

    this._xvfbProcess = spawn('Xvfb', [
      display,
      '-screen', '0', '1920x1080x24',
      '-ac',
      '-nolisten', 'tcp'
    ], {
      stdio: 'ignore',
      detached: true
    });

    this._xvfbProcess.unref();

    this._xvfbProcess.on('error', (err) => {
      console.error(`[chrome-launcher] Xvfb error: ${err.message}`);
      this._xvfbProcess = null;
    });

    this._xvfbProcess.on('exit', (code) => {
      console.log(`[chrome-launcher] Xvfb exited with code ${code}`);
      this._xvfbProcess = null;
    });

    process.env.DISPLAY = display;
    console.log(`[chrome-launcher] Xvfb started, DISPLAY=${display} (pid ${this._xvfbProcess.pid})`);
  }

  async _launch() {
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion'
    ];

    if (os.platform() === 'linux') {
      args.push('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
    }

    args.push('https://www.zhipin.com/');

    try {
      this._process = spawn(this.chromePath, args, {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env }
      });

      this._process.unref();

      this._process.on('error', (err) => {
        console.error(`[chrome-launcher] Chrome process error: ${err.message}`);
        this._process = null;
      });

      this._process.on('exit', (code) => {
        console.log(`[chrome-launcher] Chrome process exited with code ${code}`);
        this._process = null;
      });

      await this._waitForReady();
      console.log(`[chrome-launcher] Chrome started successfully on port ${this.port}`);
      await this._ensureBossPage();
      return { started: true, alreadyRunning: false, pid: this._process?.pid };
    } catch (err) {
      console.error(`[chrome-launcher] Failed to start Chrome: ${err.message}`);
      if (this._process) {
        this._process.kill();
        this._process = null;
      }
      throw err;
    }
  }

  async _ensureBossPage() {
    const bossUrl = 'https://www.zhipin.com/';
    try {
      const response = await fetch(`${this.cdpEndpoint}/json`);
      if (!response.ok) return;
      const targets = await response.json();
      const pages = (Array.isArray(targets) ? targets : []).filter(
        (t) => t.type === 'page'
      );
      const hasBoss = pages.some(
        (t) => t.url && t.url.startsWith(bossUrl)
      );
      if (hasBoss) {
        console.log('[chrome-launcher] BOSS page already open');
        return;
      }

      const blank = pages.find((t) => t.url === 'about:blank' || t.url === 'chrome://newtab/');
      const targetId = blank?.id || pages[0]?.id;
      if (!targetId) {
        console.log('[chrome-launcher] No page target to navigate, creating new tab');
        await fetch(`${this.cdpEndpoint}/json/new?${bossUrl}`);
        console.log(`[chrome-launcher] Opened ${bossUrl} in new tab`);
        return;
      }

      const wsUrl = (blank || pages[0]).webSocketDebuggerUrl;
      if (!wsUrl) return;
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error('ws_connect_failed')), { once: true });
        setTimeout(() => reject(new Error('ws_connect_timeout')), 5000);
      });
      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.navigate',
        params: { url: bossUrl }
      }));
      await new Promise((resolve) => {
        ws.addEventListener('message', (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === 1) resolve();
        });
        setTimeout(resolve, 5000);
      });
      ws.close();
      console.log(`[chrome-launcher] Navigated to ${bossUrl}`);
    } catch (err) {
      console.warn(`[chrome-launcher] Failed to open BOSS page: ${err.message}`);
    }
  }

  async _waitForReady(maxAttempts = 15, intervalMs = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (await this.isRunning()) {
        return;
      }
    }
    throw new Error(`Chrome did not become ready at ${this.cdpEndpoint} after ${maxAttempts} attempts`);
  }
}

module.exports = { ChromeLauncher, needsVirtualDisplay, isXvfbInstalled, findFreeDisplay, detectLinuxChromePath };

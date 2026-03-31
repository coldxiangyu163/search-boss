const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  linux: '/usr/bin/google-chrome'
};

class ChromeLauncher {
  constructor({ cdpEndpoint, chromePath, userDataDir, downloadDir } = {}) {
    this.cdpEndpoint = cdpEndpoint || 'http://127.0.0.1:9222';
    this.chromePath = chromePath || DEFAULT_CHROME_PATHS[os.platform()] || 'google-chrome';
    this.userDataDir = userDataDir || path.join(os.homedir(), '.chrome-boss-profile');
    this.downloadDir = downloadDir || path.join(os.homedir(), '.chrome-boss-downloads');
    this._process = null;

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
      return { started: false, alreadyRunning: true };
    }

    console.log(`[chrome-launcher] Chrome not detected at ${this.cdpEndpoint}, starting...`);
    return this._launch();
  }

  async _launch() {
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ];

    try {
      this._process = spawn(this.chromePath, args, {
        stdio: 'ignore',
        detached: true
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

module.exports = { ChromeLauncher };

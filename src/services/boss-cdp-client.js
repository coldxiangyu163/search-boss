class BossCdpClient {
  constructor({
    endpoint = 'http://127.0.0.1:9222',
    requestImpl = fetch,
    connectImpl = connectWebSocket
  } = {}) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.requestImpl = requestImpl;
    this.connectImpl = connectImpl;
    this.nextMessageId = 1;
  }

  async listTargets() {
    const response = await this.requestImpl(`${this.endpoint}/json`);

    if (!response.ok) {
      throw new Error(`boss_cdp_list_targets_failed:${response.status || 'unknown'}`);
    }

    const targets = await response.json();
    return Array.isArray(targets) ? targets : [];
  }

  async resolveBossTarget({ targetId = null, urlPrefix = 'https://www.zhipin.com/', preferUrl = null } = {}) {
    const targets = await this.listTargets();

    if (targetId) {
      const target = targets.find((candidate) => candidate?.id === targetId);

      if (isBossPageTarget(target, urlPrefix)) {
        return target;
      }

      // targetId is stale (tab closed/refreshed) — fall through to URL-based discovery
    }

    const bossTabs = targets.filter((candidate) => isBossPageTarget(candidate, urlPrefix));

    if (preferUrl) {
      const preferred = bossTabs.find((t) => t.url && t.url.includes(preferUrl));
      if (preferred) {
        return preferred;
      }
    }

    const target = bossTabs.sort(compareBossTargets).at(0);

    if (!target) {
      throw new Error('boss_target_not_found');
    }

    return target;
  }

  async evaluate({ targetId, expression, urlPrefix } = {}) {
    return this.sendCommand({
      targetId,
      urlPrefix,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true
      }
    });
  }

  async sendCommand({ targetId, method, params = {}, urlPrefix, timeoutMs = 15_000, retries = 3 } = {}) {
    if (!targetId) {
      throw new Error('boss_target_id_required');
    }

    if (!method || typeof method !== 'string') {
      throw new Error('boss_cdp_method_required');
    }

    if (method === 'Runtime.evaluate') {
      if (!params.expression || typeof params.expression !== 'string') {
        throw new Error('boss_expression_required');
      }
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
      }

      let connection;
      try {
        const target = await this.resolveBossTarget({ targetId, urlPrefix });
        const websocketUrl = target.webSocketDebuggerUrl;

        if (!websocketUrl) {
          throw new Error('boss_target_websocket_missing');
        }

        connection = await this.connectImpl(websocketUrl);
        const messageId = this.nextMessageId;
        this.nextMessageId += 1;

        await connection.send(JSON.stringify({ id: messageId, method, params }));

        while (true) {
          const rawMessage = await Promise.race([
            connection.waitForMessage(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('boss_cdp_command_timeout')), timeoutMs)
            )
          ]);

          const message = JSON.parse(rawMessage);

          if (message.id !== messageId) {
            continue;
          }

          if (message.error) {
            throw new Error(message.error.message || 'boss_cdp_evaluate_failed');
          }

          return message.result?.result ?? message.result ?? null;
        }
      } catch (err) {
        lastError = err;
        if (connection) {
          await connection.close().catch(() => {});
          connection = null;
        }
        if (!isTransientCdpError(err)) {
          throw err;
        }
      } finally {
        if (connection) {
          await connection.close().catch(() => {});
        }
      }
    }

    throw lastError;
  }

  async captureScreenshot({ targetId, urlPrefix, format = 'jpeg', quality = 70 } = {}) {
    const target = await this.resolveBossTarget({
      targetId,
      urlPrefix: urlPrefix || 'https://www.zhipin.com/'
    });

    const result = await this.sendCommand({
      targetId: target.id,
      urlPrefix,
      method: 'Page.captureScreenshot',
      params: { format, quality }
    });

    if (!result?.data) {
      throw new Error('boss_screenshot_empty');
    }

    return { data: result.data, format };
  }

  async captureAnyScreenshot({ endpoint, format = 'jpeg', quality = 70 } = {}) {
    const cdpEndpoint = endpoint || this.endpoint;
    const response = await this.requestImpl(`${cdpEndpoint}/json`);
    if (!response.ok) {
      throw new Error('boss_cdp_list_targets_failed');
    }
    const targets = await response.json();
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (t) => t.type === 'page' && t.url !== 'about:blank' && !t.url.startsWith('devtools://')
    );
    if (!pages.length) {
      throw new Error('boss_no_page_target');
    }
    const target = pages[0];
    const result = await this.sendCommand({
      targetId: target.id,
      method: 'Page.captureScreenshot',
      params: { format, quality }
    });
    if (!result?.data) {
      throw new Error('boss_screenshot_empty');
    }

    let viewport = null;
    try {
      const sizeResult = await this.sendCommand({
        targetId: target.id,
        method: 'Runtime.evaluate',
        params: {
          expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })',
          returnByValue: true
        }
      });
      viewport = JSON.parse(sizeResult?.value || '{}');
    } catch {
      // viewport info is best-effort
    }

    return { data: result.data, format, url: target.url, title: target.title, viewport };
  }

  async clickOnAnyPage({ x, y, endpoint } = {}) {
    const normalizedX = Number(x);
    const normalizedY = Number(y);
    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
      throw new Error('boss_mouse_coordinates_required');
    }

    const cdpEndpoint = endpoint || this.endpoint;
    const response = await this.requestImpl(`${cdpEndpoint}/json`);
    if (!response.ok) {
      throw new Error('boss_cdp_list_targets_failed');
    }
    const targets = await response.json();
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (t) => t.type === 'page' && t.url !== 'about:blank' && !t.url.startsWith('devtools://')
    );
    if (!pages.length) {
      throw new Error('boss_no_page_target');
    }
    const target = pages[0];

    const mouseEvents = [
      { type: 'mouseMoved', button: 'none' },
      { type: 'mousePressed', button: 'left', clickCount: 1 },
      { type: 'mouseReleased', button: 'left', clickCount: 1 }
    ];
    for (const evt of mouseEvents) {
      await this.sendCommand({
        targetId: target.id,
        method: 'Input.dispatchMouseEvent',
        params: { ...evt, x: normalizedX, y: normalizedY }
      });
    }

    return { ok: true, x: normalizedX, y: normalizedY, url: target.url };
  }

  async bringToFront({ targetId, urlPrefix } = {}) {
    await this.sendCommand({
      targetId,
      urlPrefix,
      method: 'Page.bringToFront',
      params: {}
    });
  }

  async dispatchMouseClick({ targetId, x, y, urlPrefix } = {}) {
    const normalizedX = Number(x);
    const normalizedY = Number(y);

    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
      throw new Error('boss_mouse_coordinates_required');
    }

    await this.sendCommand({
      targetId,
      urlPrefix,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: normalizedX,
        y: normalizedY,
        button: 'none'
      }
    });

    await this.sendCommand({
      targetId,
      urlPrefix,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: normalizedX,
        y: normalizedY,
        button: 'left',
        clickCount: 1
      }
    });

    await this.sendCommand({
      targetId,
      urlPrefix,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseReleased',
        x: normalizedX,
        y: normalizedY,
        button: 'left',
        clickCount: 1
      }
    });
  }
}

function isBossPageTarget(target, urlPrefix) {
  if (!target || target.type !== 'page' || typeof target.url !== 'string') {
    return false;
  }

  if (target.url === 'about:blank' || target.url.startsWith('devtools://')) {
    return false;
  }

  return target.url.startsWith(urlPrefix);
}

function compareBossTargets(left, right) {
  return scoreBossTarget(right) - scoreBossTarget(left);
}

function scoreBossTarget(target) {
  const url = String(target?.url || '');

  if (url.includes('/web/chat/recommend')) {
    return 500;
  }

  if (url.includes('/web/chat/index')) {
    return 400;
  }

  if (url.includes('/web/geek/')) {
    return 300;
  }

  if (url.includes('/web/user/')) {
    return 50;
  }

  return 100;
}

async function connectWebSocket(url) {
  const socket = new WebSocket(url);
  const messageQueue = [];
  const waiters = [];

  const flushWaiter = (payload) => {
    const waiter = waiters.shift();

    if (waiter) {
      waiter.resolve(payload);
      return true;
    }

    return false;
  };

  socket.addEventListener('message', (event) => {
    if (!flushWaiter(event.data)) {
      messageQueue.push(event.data);
    }
  });

  socket.addEventListener('error', () => {
    const error = new Error('boss_cdp_socket_error');
    while (waiters.length > 0) {
      waiters.shift().reject(error);
    }
  });

  socket.addEventListener('close', () => {
    const error = new Error('boss_cdp_socket_closed');
    while (waiters.length > 0) {
      waiters.shift().reject(error);
    }
  });
  await waitForSocketOpen(socket);

  return {
    send(message) {
      socket.send(message);
    },
    waitForMessage() {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift());
      }

      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    close() {
      if (
        socket.readyState === WebSocket.CLOSING ||
        socket.readyState === WebSocket.CLOSED
      ) {
        return Promise.resolve();
      }

      socket.close();
      return Promise.resolve();
    }
  };
}

function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
      socket.removeEventListener('close', handleClose);
    };

    const handleOpen = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('boss_cdp_socket_error'));
    };

    const handleClose = () => {
      cleanup();
      reject(new Error('boss_cdp_socket_closed'));
    };

    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('error', handleError, { once: true });
    socket.addEventListener('close', handleClose, { once: true });
  });
}

function isTransientCdpError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('boss_cdp_socket_error') ||
    msg.includes('boss_cdp_socket_closed') ||
    msg.includes('boss_cdp_list_targets_failed') ||
    msg.includes('boss_target_not_found') ||
    msg.includes('boss_cdp_command_timeout')
  );
}

module.exports = {
  BossCdpClient,
  connectWebSocket
};

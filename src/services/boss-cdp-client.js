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

  async resolveBossTarget({ targetId = null, urlPrefix = 'https://www.zhipin.com/' } = {}) {
    const targets = await this.listTargets();

    if (targetId) {
      const target = targets.find((candidate) => candidate?.id === targetId);

      if (isBossPageTarget(target, urlPrefix)) {
        return target;
      }

      throw new Error('boss_target_not_found');
    }

    const target = targets.find((candidate) => isBossPageTarget(candidate, urlPrefix));

    if (!target) {
      throw new Error('boss_target_not_found');
    }

    return target;
  }

  async evaluate({ targetId, expression, urlPrefix } = {}) {
    if (!targetId) {
      throw new Error('boss_target_id_required');
    }

    if (!expression || typeof expression !== 'string') {
      throw new Error('boss_expression_required');
    }

    const target = await this.resolveBossTarget({ targetId, urlPrefix });
    const websocketUrl = target.webSocketDebuggerUrl;

    if (!websocketUrl) {
      throw new Error('boss_target_websocket_missing');
    }

    const connection = await this.connectImpl(websocketUrl);
    const messageId = this.nextMessageId;
    this.nextMessageId += 1;

    try {
      await connection.send(JSON.stringify({
        id: messageId,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }));

      while (true) {
        const rawMessage = await connection.waitForMessage();
        const message = JSON.parse(rawMessage);

        if (message.id !== messageId) {
          continue;
        }

        if (message.error) {
          throw new Error(message.error.message || 'boss_cdp_evaluate_failed');
        }

        return message.result?.result || null;
      }
    } finally {
      await connection.close();
    }
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

module.exports = {
  BossCdpClient,
  connectWebSocket
};

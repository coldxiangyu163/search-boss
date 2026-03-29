const fs = require('node:fs/promises');
const { resolveRuntimeEnv } = require('../src/runtime-env');

const LEGACY_API_BASE = 'http://127.0.0.1:3000';
const LEGACY_TOKEN = 'search-boss-local-agent';

const COMMANDS = {
  'jobs-batch': { method: 'POST', path: () => '/api/agent/jobs/batch', requiresFile: true },
  'run-create': { method: 'POST', path: () => '/api/agent/runs', requiresFile: true },
  'run-event': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/events`, requiresRunId: true, requiresFile: true },
  'run-candidate': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/candidates`, requiresRunId: true, requiresFile: true },
  'run-message': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/messages`, requiresRunId: true, requiresFile: true },
  'run-action': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/actions`, requiresRunId: true, requiresFile: true },
  'run-attachment': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/attachments`, requiresRunId: true, requiresFile: true },
  'run-import-events': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/import-events`, requiresRunId: true, requiresFile: true },
  'run-complete': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/complete`, requiresRunId: true, requiresFile: true },
  'run-fail': { method: 'POST', path: ({ runId }) => `/api/agent/runs/${encodeURIComponent(runId)}/fail`, requiresRunId: true, requiresFile: true },
  'followup-decision': { method: 'GET', path: ({ candidateId }) => `/api/agent/candidates/${encodeURIComponent(candidateId)}/followup-decision`, requiresCandidateId: true },
  'list-candidates': {
    method: 'GET',
    path: ({ jobKey, page, pageSize, keyword, status, resumeState }) => {
      const params = new URLSearchParams({
        jobKey
      });

      if (page) {
        params.set('page', page);
      }

      if (pageSize) {
        params.set('pageSize', pageSize);
      }

      if (keyword) {
        params.set('keyword', keyword);
      }

      if (status) {
        params.set('status', status);
      }

      if (resumeState) {
        params.set('resumeState', resumeState);
      }

      return `/api/candidates?${params.toString()}`;
    },
    requiresJobKey: true
  },
  'dashboard-summary': { method: 'GET', path: () => '/api/dashboard/summary', includeToken: false },
  'run-events': { method: 'GET', path: ({ runId, afterId }) => `/api/runs/${encodeURIComponent(runId)}/events${afterId ? `?afterId=${encodeURIComponent(afterId)}` : ''}`, requiresRunId: true, includeToken: false }
};

async function executeCli(
  argv,
  {
    requestImpl = defaultRequestImpl,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    envFilePath
  } = {}
) {
  try {
    const runtimeEnv = resolveRuntimeEnv({ env, envFilePath });
    const options = parseArgs(argv, { env: runtimeEnv });
    const command = COMMANDS[options.command];

    if (!command) {
      throw new Error(`Unknown command: ${options.command || '<missing>'}`);
    }

    validateRequired(command, options);
    const body = command.requiresFile ? await readPayloadFile(options.file) : undefined;
    const payload = mergePayload(command, options, body);
    const url = buildUrl(command, options);
    const response = await requestImpl({
      method: command.method,
      url,
      body: payload
    });
    if (response && (response.ok === false || response.status >= 400)) {
      throw await buildLocalApiError(response);
    }
    const data = await response.json();
    stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return { exitCode: 0, stdout: JSON.stringify(data) };
  } catch (error) {
    const message = error.message || String(error);
    stderr.write(`${message}\n`);
    return { exitCode: 1, stderr: message };
  }
}

function parseArgs(argv, { env = process.env } = {}) {
  const [command, ...rest] = argv;
  const options = {
    command,
    apiBase: env.SEARCH_BOSS_API_BASE || env.AGENT_CALLBACK_API_BASE || LEGACY_API_BASE,
    token: env.SEARCH_BOSS_AGENT_TOKEN || env.AGENT_TOKEN || LEGACY_TOKEN
  };

  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];

    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    options[toCamelCase(key.slice(2))] = value;
    index += 1;
  }

  return options;
}

function validateRequired(command, options) {
  if (!options.command) {
    throw new Error('Missing command');
  }

  if (command.requiresRunId && !options.runId) {
    throw new Error('Missing required argument: --run-id');
  }

  if (command.requiresCandidateId && !options.candidateId) {
    throw new Error('Missing required argument: --candidate-id');
  }

  if (command.requiresJobKey && !options.jobKey) {
    throw new Error('Missing required argument: --job-key');
  }

  if (command.requiresFile && !options.file) {
    throw new Error('Missing required argument: --file');
  }
}

async function readPayloadFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function mergePayload(command, options, body) {
  if (!command.requiresFile) {
    return undefined;
  }

  const normalizedBody = normalizePayload(command, body, options);

  if (options.runId && normalizedBody && normalizedBody.runId === undefined) {
    return {
      ...normalizedBody,
      runId: options.runId
    };
  }

  return normalizedBody;
}

function normalizePayload(command, body, options) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (options.command !== 'run-message') {
    return body;
  }

  const occurredAt = body.occurredAt || body.sentAt;
  const contentText = body.contentText || body.content;
  const bossMessageId = body.bossMessageId
    || `auto:${options.runId || body.runId || 'no-run'}:${body.direction || 'unknown'}:${occurredAt || new Date().toISOString()}`;

  const normalized = {
    ...body,
    bossMessageId,
    contentText
  };

  if (occurredAt && normalized.occurredAt === undefined) {
    normalized.occurredAt = occurredAt;
  }

  delete normalized.content;
  delete normalized.sentAt;
  return normalized;
}

function buildUrl(command, options) {
  const base = options.apiBase.replace(/\/$/, '');
  const path = command.path(options);
  if (command.includeToken === false) {
    return `${base}${path}`;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${base}${path}${separator}token=${encodeURIComponent(options.token)}`;
}

async function defaultRequestImpl({ method, url, body }) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    throw await buildLocalApiError(response);
  }

  return response;
}

async function buildLocalApiError(response) {
  const status = Number(response?.status) || 0;
  const detail = await readErrorDetail(response);
  return new Error(detail ? `Local API failed: ${status} - ${detail}` : `Local API failed: ${status}`);
}

async function readErrorDetail(response) {
  try {
    const contentType = typeof response?.headers?.get === 'function'
      ? response.headers.get('content-type')
      : response?.headers instanceof Map
        ? response.headers.get('content-type')
        : '';

    if (contentType && /application\/json/i.test(contentType) && typeof response?.json === 'function') {
      const payload = await response.json();
      return payload?.message || payload?.error || '';
    }

    if (typeof response?.json === 'function' && typeof response?.text !== 'function') {
      const payload = await response.json();
      return payload?.message || payload?.error || '';
    }

    if (typeof response?.text === 'function') {
      const text = await response.text();
      if (!text) {
        return '';
      }

      try {
        const payload = JSON.parse(text);
        return payload?.message || payload?.error || text;
      } catch {
        return text;
      }
    }
  } catch {
    return '';
  }

  return '';
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

if (require.main === module) {
  executeCli(process.argv.slice(2)).then((result) => {
    process.exitCode = result.exitCode;
  });
}

module.exports = {
  executeCli
};

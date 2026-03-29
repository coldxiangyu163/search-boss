const path = require('node:path');
const { resolveRuntimeEnv } = require('./runtime-env');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BOSS_CLI_SESSION_DIR = path.join(REPO_ROOT, 'tmp');

function buildConfig(env = process.env) {
  const missing = [];
  const databaseUrl = readRequiredEnv(env, 'DATABASE_URL', missing);
  const agentToken = readRequiredEnv(env, 'AGENT_TOKEN', missing);
  const nanobotConfigPath = resolveRepoRelativePath(
    readRequiredEnv(env, 'NANOBOT_CONFIG_PATH', missing)
  );

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: Number(env.PORT || 3000),
    databaseUrl,
    sourceDatabaseUrl: readOptionalEnv(env, 'SOURCE_DATABASE_URL'),
    agentToken,
    nanobotConfigPath,
    bossCdpEndpoint: readOptionalEnv(env, 'BOSS_CDP_ENDPOINT') || 'http://127.0.0.1:9222',
    bossCdpTargetUrlPrefix:
      readOptionalEnv(env, 'BOSS_CDP_TARGET_URL_PREFIX') || 'https://www.zhipin.com/',
    bossCliSessionDir: readOptionalEnv(env, 'BOSS_CLI_SESSION_DIR') || DEFAULT_BOSS_CLI_SESSION_DIR,
    bossCliEnabled: readBooleanEnv(env, 'BOSS_CLI_ENABLED', false),
    sourceLoopEnabled: readBooleanEnv(env, 'SOURCE_LOOP_ENABLED', false),
    sourceLoopTargetCount: Number(readOptionalEnv(env, 'SOURCE_LOOP_TARGET_COUNT') || 5),
    followupLoopMaxThreads: Number(readOptionalEnv(env, 'FOLLOWUP_LOOP_MAX_THREADS') || 1),
    loopDelayMin: Number(readOptionalEnv(env, 'LOOP_DELAY_MIN') || 2000),
    loopDelayMax: Number(readOptionalEnv(env, 'LOOP_DELAY_MAX') || 5000),
    llmApiBase: readOptionalEnv(env, 'LLM_API_BASE') || 'https://www.openclaudecode.cn/v1',
    llmApiKey: readOptionalEnv(env, 'LLM_API_KEY'),
    llmModel: readOptionalEnv(env, 'LLM_MODEL') || 'gpt-5.4'
  };
}

function readRequiredEnv(env, key, missing) {
  const value = readOptionalEnv(env, key);

  if (!value) {
    missing.push(key);
  }

  return value;
}

function readOptionalEnv(env, key) {
  const value = env[key];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBooleanEnv(env, key, defaultValue) {
  const value = readOptionalEnv(env, key);

  if (value === null) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function resolveRepoRelativePath(value) {
  if (!value || isAbsolutePath(value)) {
    return value;
  }

  return path.resolve(REPO_ROOT, value);
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function loadConfig({ env = process.env, envFilePath } = {}) {
  return buildConfig(resolveRuntimeEnv({ env, envFilePath }));
}

const config = new Proxy(
  {},
  {
    get(_target, property) {
      return loadConfig()[property];
    },
    ownKeys() {
      return Reflect.ownKeys(loadConfig());
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true
      };
    }
  }
);

module.exports = {
  buildConfig,
  loadConfig,
  config
};

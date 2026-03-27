const { resolveRuntimeEnv } = require('./runtime-env');

function buildConfig(env = process.env) {
  const missing = [];
  const databaseUrl = readRequiredEnv(env, 'DATABASE_URL', missing);
  const agentToken = readRequiredEnv(env, 'AGENT_TOKEN', missing);
  const nanobotConfigPath = readRequiredEnv(env, 'NANOBOT_CONFIG_PATH', missing);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: Number(env.PORT || 3000),
    databaseUrl,
    sourceDatabaseUrl: readOptionalEnv(env, 'SOURCE_DATABASE_URL'),
    agentToken,
    nanobotConfigPath
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

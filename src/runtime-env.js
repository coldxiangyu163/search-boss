const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function resolveRuntimeEnv({ env = process.env, envFilePath } = {}) {
  const fileValues = loadEnvFiles({ envFilePath });
  return {
    ...fileValues,
    ...env
  };
}

function loadEnvFiles({ envFilePath } = {}) {
  const filePaths = envFilePath
    ? [envFilePath]
    : [path.join(REPO_ROOT, '.env'), path.join(REPO_ROOT, '.env.local')];

  return filePaths.reduce((merged, filePath) => ({
    ...merged,
    ...loadEnvFile(filePath)
  }), {});
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7) : line;
    const separatorIndex = normalizedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    values[key] = stripQuotes(rawValue);
  }

  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

module.exports = {
  resolveRuntimeEnv
};

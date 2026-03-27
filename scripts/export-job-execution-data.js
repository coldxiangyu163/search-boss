const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../src/db/pool');
const { resolveRuntimeEnv } = require('../src/runtime-env');
const { exportExecutionData } = require('../src/services/execution-export-service');

async function executeCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    envFilePath,
    exportExecutionDataImpl = exportExecutionData
  } = {}
) {
  let pool = null;

  try {
    const runtimeEnv = resolveRuntimeEnv({ env, envFilePath });
    const options = parseArgs(argv);
    const databaseUrl = readRequiredEnv(runtimeEnv, 'DATABASE_URL');

    pool = createPool(databaseUrl);

    const result = await exportExecutionDataImpl({
      pool,
      jobKey: options.job || null
    });

    const rendered = `${JSON.stringify(result, null, 2)}\n`;

    if (options.output) {
      const outputFile = path.resolve(options.output);
      await fs.writeFile(outputFile, rendered, 'utf8');
      stdout.write(`${JSON.stringify(buildSummary(result, outputFile), null, 2)}\n`);
    } else {
      stdout.write(rendered);
    }

    return { exitCode: 0 };
  } catch (error) {
    const message = error.message || String(error);
    stderr.write(`${message}\n`);
    return { exitCode: 1, stderr: message };
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

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

function buildSummary(result, outputFile) {
  return {
    outputFile,
    filter: result.filter,
    counts: {
      jobs: result.jobs.length,
      sourcingRuns: result.sourcingRuns.length,
      sourcingRunEvents: result.sourcingRunEvents.length,
      scheduledJobs: result.scheduledJobs.length,
      scheduledJobRuns: result.scheduledJobRuns.length
    }
  };
}

function readRequiredEnv(env, key) {
  const value = env[key];

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
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

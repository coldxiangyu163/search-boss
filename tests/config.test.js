const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildConfig, loadConfig } = require('../src/config');

test('buildConfig reads required runtime settings from env without machine defaults', () => {
  const runtimeEnv = {
    PORT: '4010',
    DATABASE_URL: 'postgresql://search_boss:secret@127.0.0.1:5432/search_boss_ops',
    AGENT_TOKEN: 'windows-agent-token',
    NANOBOT_CONFIG_PATH: 'C:\\apps\\nanobot-boss\\config.json'
  };

  const config = buildConfig(runtimeEnv);

  assert.equal(config.port, 4010);
  assert.equal(config.databaseUrl, runtimeEnv.DATABASE_URL);
  assert.equal(config.sourceDatabaseUrl, null);
  assert.equal(config.agentToken, runtimeEnv.AGENT_TOKEN);
  assert.equal(config.nanobotConfigPath, runtimeEnv.NANOBOT_CONFIG_PATH);
});

test('buildConfig throws when required runtime settings are missing', () => {
  assert.throws(
    () =>
      buildConfig({
        PORT: '3000'
      }),
    /Missing required environment variables: DATABASE_URL, AGENT_TOKEN, NANOBOT_CONFIG_PATH/
  );
});

test('loadConfig reads runtime settings from .env file when process env is empty', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-boss-config-'));
  const envFilePath = path.join(tempDir, '.env');

  await fs.writeFile(
    envFilePath,
    [
      'DATABASE_URL=postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_ops_20260324',
      'SOURCE_DATABASE_URL=postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_admin',
      'AGENT_TOKEN=search-boss-local-agent',
      'NANOBOT_CONFIG_PATH=/Users/coldxiangyu/.nanobot-boss/config.json'
    ].join('\n')
  );

  const config = loadConfig({
    env: {},
    envFilePath
  });

  assert.equal(
    config.databaseUrl,
    'postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_ops_20260324'
  );
  assert.equal(
    config.sourceDatabaseUrl,
    'postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_admin'
  );
  assert.equal(config.agentToken, 'search-boss-local-agent');
  assert.equal(config.nanobotConfigPath, '/Users/coldxiangyu/.nanobot-boss/config.json');
});

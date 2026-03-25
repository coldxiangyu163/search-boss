const test = require('node:test');
const assert = require('node:assert/strict');

const { NanobotRunner } = require('../src/services/nanobot-runner');

test('NanobotRunner buildCommand enables verbose logs', () => {
  const runner = new NanobotRunner({
    configPath: '/tmp/nanobot-config.json'
  });

  const command = runner.buildCommand({
    message: '/boss-sourcing --job "健康顾问_B0047007" --followup'
  });

  assert.equal(command.command, 'uv');
  assert.deepEqual(command.args, [
    'run',
    'nanobot',
    'agent',
    '--config',
    '/tmp/nanobot-config.json',
    '--logs',
    '-m',
    '/boss-sourcing --job "健康顾问_B0047007" --followup'
  ]);
});

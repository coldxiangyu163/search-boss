const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { BossContextStore } = require('../src/services/boss-context-store');

test('BossContextStore saveContext writes a run-scoped context file', async () => {
  const contextDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boss-context-store-'));
  const store = new BossContextStore({ contextDir });

  const result = await store.saveContext('88', {
    mode: 'source',
    preview: ['张三', '李四']
  });

  assert.equal(result.filePath, path.join(contextDir, 'boss-context-88.json'));
  const saved = JSON.parse(await fs.readFile(result.filePath, 'utf8'));
  assert.equal(saved.runId, '88');
  assert.equal(saved.mode, 'source');
  assert.deepEqual(saved.preview, ['张三', '李四']);
  assert.ok(saved.updatedAt);
});

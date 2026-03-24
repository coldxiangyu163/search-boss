const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');

test('GET /health returns ok payload', async () => {
  const app = createApp({
    services: {
      dashboard: {
        async getSummary() {
          return {
            kpis: {},
            queues: {},
            health: {}
          };
        }
      }
    }
  });

  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    status: 'ok'
  });
});

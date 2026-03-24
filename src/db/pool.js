const { Pool } = require('pg');
const { config } = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl
});

function createPool(connectionString) {
  return new Pool({ connectionString });
}

module.exports = {
  pool,
  createPool
};

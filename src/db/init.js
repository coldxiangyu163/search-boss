const fs = require('node:fs/promises');
const path = require('node:path');

async function ensureDatabaseSchema(client) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');
  await client.query(sql);
}

module.exports = {
  ensureDatabaseSchema
};

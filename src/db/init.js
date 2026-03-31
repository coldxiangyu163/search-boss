const fs = require('node:fs/promises');
const path = require('node:path');

async function ensureDatabaseSchema(client) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');
  await client.query(sql);

  const enterpriseSchemaPath = path.join(__dirname, 'enterprise-schema.sql');
  const enterpriseSql = await fs.readFile(enterpriseSchemaPath, 'utf8');
  await client.query(enterpriseSql);
}

module.exports = {
  ensureDatabaseSchema
};

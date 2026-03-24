const { pool } = require('../src/db/pool');
const { ensureDatabaseSchema } = require('../src/db/init');

async function main() {
  await ensureDatabaseSchema(pool);
  console.log('database schema is ready');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

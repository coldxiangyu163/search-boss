const { config } = require('../src/config');
const { pool, createPool } = require('../src/db/pool');
const { ensureDatabaseSchema } = require('../src/db/init');
const { BootstrapService } = require('../src/services/bootstrap-service');

async function main() {
  await ensureDatabaseSchema(pool);

  const sourcePool = createPool(config.sourceDatabaseUrl);
  const bootstrapService = new BootstrapService({
    targetPool: pool,
    sourcePool
  });

  const summary = await bootstrapService.syncFromSource();
  console.log(JSON.stringify(summary, null, 2));

  await sourcePool.end();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

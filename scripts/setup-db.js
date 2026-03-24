import { getConfig } from "../src/config.js";
import { ensureDatabase, initializeSchema } from "../src/db/init.js";
import { createPool } from "../src/db/pool.js";

async function main() {
  const config = getConfig();

  await ensureDatabase({
    adminConfig: config.postgres.admin,
    databaseName: config.postgres.database,
  });

  const pool = createPool(config.postgres);

  try {
    await initializeSchema(pool);
    console.log(`Database ${config.postgres.database} is ready.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

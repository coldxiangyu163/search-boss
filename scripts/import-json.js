import fs from "node:fs/promises";

import { getConfig } from "../src/config.js";
import { ensureDatabase, initializeSchema } from "../src/db/init.js";
import { createPool } from "../src/db/pool.js";
import { importLegacyData } from "../src/services/import-service.js";

async function main() {
  const config = getConfig();

  await ensureDatabase({
    adminConfig: config.postgres.admin,
    databaseName: config.postgres.database,
  });

  const pool = createPool(config.postgres);

  try {
    await initializeSchema(pool);
    await fs.access(config.data.legacyJsonPath);

    const summary = await importLegacyData({
      pool,
      jsonPath: config.data.legacyJsonPath,
      projectRoot: config.projectRoot,
    });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

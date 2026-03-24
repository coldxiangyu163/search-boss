import express from "express";
import path from "node:path";

import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { ensureDatabase, initializeSchema } from "./db/init.js";
import { createPool } from "./db/pool.js";
import { createEventBus } from "./services/event-bus.js";
import { importLegacyData } from "./services/import-service.js";
import { buildServices } from "./services/index.js";
import { createNanobotRunner } from "./services/nanobot-runner.js";
import { createSchedulerService } from "./services/scheduler-service.js";

async function main() {
  const config = getConfig();

  await ensureDatabase({
    adminConfig: config.postgres.admin,
    databaseName: config.postgres.database,
  });

  const pool = createPool(config.postgres);
  await initializeSchema(pool);
  const eventBus = createEventBus();

  const services = buildServices({
    pool,
    eventBus,
    nanobotRunner: createNanobotRunner({
      ...config.nanobot,
      agentApiBaseUrl: config.agentApi.baseUrl,
      agentToken: config.agentApi.token,
    }),
    projectRoot: config.projectRoot,
    dataFilePath: config.data.legacyJsonPath,
    importLegacyDataFn: importLegacyData,
    agentToken: config.agentApi.token,
    agentApiBaseUrl: config.agentApi.baseUrl,
  });

  const schedulerService = createSchedulerService({
    pool,
    eventBus,
    onExecuteScheduledJob: (payload) => services.executeScheduledJob(payload),
  });
  services.setSchedulerService(schedulerService);
  await schedulerService.start();

  const app = createApp({ services });
  app.use(express.static(path.join(config.projectRoot, "public")));

  app.listen(config.server.port, config.server.host, () => {
    console.log(`search-boss-admin listening at http://${config.server.host}:${config.server.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

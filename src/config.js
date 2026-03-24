import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getConfig() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  const pgHost = process.env.PGHOST || "127.0.0.1";
  const pgPort = Number(process.env.PGPORT || 5432);
  // NOTE: Default credentials are for local development only.
  // Set PGUSER and PGPASSWORD environment variables in production.
  const pgUser = process.env.PGUSER || "coldxiangyu";
  const pgPassword = process.env.PGPASSWORD || "coldxiangyu";
  const pgDatabase = process.env.PGDATABASE || "search_boss_admin";

  return {
    projectRoot,
    server: {
      host,
      port,
    },
    postgres: {
      host: pgHost,
      port: pgPort,
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      admin: {
        host: pgHost,
        port: pgPort,
        user: pgUser,
        password: pgPassword,
        database: "postgres",
      },
    },
    data: {
      legacyJsonPath: path.join(projectRoot, "data", "candidates.json"),
    },
    nanobot: {
      configPath: process.env.NANOBOT_CONFIG || "/Users/coldxiangyu/.nanobot-boss/config.json",
      workspace: process.env.NANOBOT_WORKSPACE || "/Users/coldxiangyu/.nanobot-boss/workspace",
    },
    agentApi: {
      token: process.env.AGENT_API_TOKEN || "search-boss-local-agent",
      baseUrl: process.env.AGENT_API_BASE || `http://${host}:${port}`,
    },
  };
}

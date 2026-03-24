import pg from "pg";

const { Pool } = pg;

export function createPool(config) {
  return new Pool({
    host: config.host,
    port: Number(config.port || 5432),
    user: config.user,
    password: config.password,
    database: config.database,
  });
}

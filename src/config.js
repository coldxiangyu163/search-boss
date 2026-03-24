const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_ops_20260324',
  sourceDatabaseUrl:
    process.env.SOURCE_DATABASE_URL || 'postgresql://coldxiangyu:coldxiangyu@127.0.0.1:5432/search_boss_admin',
  agentToken: process.env.AGENT_TOKEN || 'search-boss-local-agent',
  nanobotConfigPath: process.env.NANOBOT_CONFIG_PATH || '/Users/coldxiangyu/.nanobot-boss/config.json'
};

module.exports = {
  config
};

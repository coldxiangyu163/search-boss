const { createApp } = require('./app');
const { config } = require('./config');
const { pool } = require('./db/pool');
const { DashboardService } = require('./services/dashboard-service');
const { JobService } = require('./services/job-service');
const { CandidateService } = require('./services/candidate-service');
const { AgentService } = require('./services/agent-service');
const { SchedulerService } = require('./services/scheduler-service');
const { NanobotRunner } = require('./services/nanobot-runner');

const nanobotRunner = new NanobotRunner({
  configPath: config.nanobotConfigPath
});

const agentService = new AgentService({ pool, nanobotRunner });
const schedulerService = new SchedulerService({ pool, agentService });

const app = createApp({
  services: {
    dashboard: new DashboardService({ pool }),
    jobs: new JobService({ pool, agentService }),
    candidates: new CandidateService({ pool }),
    agent: agentService,
    scheduler: schedulerService
  },
  config
});

const port = config.port;

app.listen(port, () => {
  console.log(`search-boss listening on ${port}`);
});

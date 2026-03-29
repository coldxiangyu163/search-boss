const { createApp } = require('./app');
const { config } = require('./config');
const { pool } = require('./db/pool');
const { DashboardService } = require('./services/dashboard-service');
const { JobService } = require('./services/job-service');
const { CandidateService } = require('./services/candidate-service');
const { AgentService } = require('./services/agent-service');
const { SchedulerService } = require('./services/scheduler-service');
const { NanobotRunner } = require('./services/nanobot-runner');
const { BossCliRunner } = require('./services/boss-cli-runner');
const { BossContextStore } = require('./services/boss-context-store');
const { RunOrchestrator } = require('./services/run-orchestrator');
const { DeterministicContextService } = require('./services/deterministic-context-service');

const nanobotRunner = new NanobotRunner({
  configPath: config.nanobotConfigPath
});

const bossCliRunner = config.bossCliEnabled
  ? new BossCliRunner()
  : null;
const bossContextStore = config.bossCliEnabled
  ? new BossContextStore({ contextDir: config.bossCliSessionDir })
  : null;

const agentService = new AgentService({ pool, nanobotRunner, bossCliRunner, bossContextStore });
agentService.deterministicContextService = new DeterministicContextService({
  bossCliRunner,
  bossContextStore,
  getJobContext: (jobKey) => agentService._getJobNanobotContext(jobKey),
  recordRunEvent: (payload) => agentService.recordRunEvent(payload)
});
agentService.runOrchestrator = new RunOrchestrator({ agentService });
const schedulerService = new SchedulerService({ pool, agentService });
const jobService = new JobService({ pool, agentService });
agentService.jobService = jobService;

const app = createApp({
  services: {
    dashboard: new DashboardService({ pool }),
    jobs: jobService,
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

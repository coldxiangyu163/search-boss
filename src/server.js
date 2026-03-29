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
const { SourceLoopService } = require('./services/source-loop-service');
const { FollowupLoopService } = require('./services/followup-loop-service');
const { LlmEvaluator } = require('./services/llm-evaluator');

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

const llmEvaluator = config.llmApiKey
  ? new LlmEvaluator({
    apiBase: config.llmApiBase,
    apiKey: config.llmApiKey,
    model: config.llmModel
  })
  : null;

const sourceLoopService = (config.sourceLoopEnabled && bossCliRunner && llmEvaluator)
  ? new SourceLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    targetCount: config.sourceLoopTargetCount,
    candidateDelayMin: config.loopDelayMin,
    candidateDelayMax: config.loopDelayMax
  })
  : null;

const followupLoopService = (config.sourceLoopEnabled && bossCliRunner && llmEvaluator)
  ? new FollowupLoopService({
    bossCliRunner,
    agentService,
    llmEvaluator,
    maxThreads: config.followupLoopMaxThreads,
    threadDelayMin: config.loopDelayMin,
    threadDelayMax: config.loopDelayMax
  })
  : null;

const schedulerService = new SchedulerService({ pool, agentService, sourceLoopService, followupLoopService });
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

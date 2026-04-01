const { createApp } = require('./app');
const { config } = require('./config');
const { pool } = require('./db/pool');
const { DashboardService } = require('./services/dashboard-service');
const { JobService } = require('./services/job-service');
const { CandidateService } = require('./services/candidate-service');
const { AgentService } = require('./services/agent-service');
const { AuthService } = require('./services/auth-service');
const { SchedulerService } = require('./services/scheduler-service');
const { TaskLock } = require('./services/task-lock');
const { NanobotRunner } = require('./services/nanobot-runner');
const { BossCliRunner } = require('./services/boss-cli-runner');
const { BossContextStore } = require('./services/boss-context-store');
const { RunOrchestrator } = require('./services/run-orchestrator');
const { DeterministicContextService } = require('./services/deterministic-context-service');
const { SourceLoopService } = require('./services/source-loop-service');
const { FollowupLoopService } = require('./services/followup-loop-service');
const { LlmEvaluator } = require('./services/llm-evaluator');
const { BrowserInstanceManager } = require('./services/browser-instance-manager');
const { ChromeLauncher } = require('./services/chrome-launcher');

const nanobotRunner = new NanobotRunner({
  configPath: config.nanobotConfigPath
});

const bossCliRunner = config.bossCliEnabled
  ? new BossCliRunner()
  : null;

const browserInstanceManager = new BrowserInstanceManager({
  pool,
  fallbackRunner: bossCliRunner
});
const bossContextStore = config.bossCliEnabled
  ? new BossContextStore({ contextDir: config.bossCliSessionDir })
  : null;

const agentService = new AgentService({ pool, nanobotRunner, bossCliRunner, bossContextStore, browserInstanceManager });
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

const taskLock = new TaskLock();
const schedulerService = new SchedulerService({ pool, agentService, sourceLoopService, followupLoopService, taskLock, browserInstanceManager });
const jobService = new JobService({ pool, agentService });
agentService.jobService = jobService;

const app = createApp({
  services: {
    auth: new AuthService({ pool }),
    dashboard: new DashboardService({ pool, bossCliRunner, browserInstanceManager }),
    jobs: jobService,
    candidates: new CandidateService({ pool }),
    agent: agentService,
    scheduler: schedulerService,
    taskLock
  },
  config,
  pool
});

const port = config.port;

async function ensureBrowserInstances() {
  const result = await pool.query(`
    select bi.id, bi.cdp_endpoint, bi.user_data_dir, bi.download_dir,
           bi.debug_port, bi.host, bi.instance_name
    from browser_instances bi
    join boss_accounts ba on ba.id = bi.boss_account_id
    where ba.status = 'active'
    order by bi.id
  `);

  const instances = result.rows;

  if (instances.length === 0) {
    console.log('[startup] No browser instances configured in database, using global config fallback');
    const launcher = new ChromeLauncher({
      cdpEndpoint: config.bossCdpEndpoint,
      chromePath: config.chromePath,
      userDataDir: config.chromeUserDataDir,
      downloadDir: config.chromeDownloadDir
    });
    try {
      await launcher.ensureRunning();
    } catch (err) {
      console.error(`[startup] Chrome auto-start failed: ${err.message}`);
    }
    return;
  }

  console.log(`[startup] Checking ${instances.length} browser instance(s) from database`);

  for (const instance of instances) {
    const label = instance.instance_name || `instance#${instance.id}`;
    const launcher = new ChromeLauncher({
      cdpEndpoint: instance.cdp_endpoint,
      chromePath: config.chromePath,
      userDataDir: instance.user_data_dir,
      downloadDir: instance.download_dir
    });

    try {
      const { alreadyRunning } = await launcher.ensureRunning();
      await pool.query(
        "update browser_instances set status = 'idle', last_seen_at = now(), updated_at = now() where id = $1",
        [instance.id]
      );
      console.log(`[startup] ${label} (${instance.cdp_endpoint}): ${alreadyRunning ? 'already running' : 'started'}`);
    } catch (err) {
      await pool.query(
        "update browser_instances set status = 'offline', updated_at = now() where id = $1",
        [instance.id]
      );
      console.error(`[startup] ${label} (${instance.cdp_endpoint}): failed - ${err.message}`);
    }
  }
}

const HEALTH_CHECK_INTERVAL_MS = 15_000;

async function checkBrowserInstancesHealth() {
  try {
    const result = await pool.query(`
      select bi.id, bi.cdp_endpoint, bi.user_data_dir, bi.download_dir,
             bi.instance_name, bi.status
      from browser_instances bi
      join boss_accounts ba on ba.id = bi.boss_account_id
      where ba.status = 'active'
      order by bi.id
    `);

    for (const instance of result.rows) {
      const label = instance.instance_name || `instance#${instance.id}`;
      const launcher = new ChromeLauncher({
        cdpEndpoint: instance.cdp_endpoint,
        chromePath: config.chromePath,
        userDataDir: instance.user_data_dir,
        downloadDir: instance.download_dir
      });

      const running = await launcher.isRunning();
      if (running) {
        if (instance.status === 'offline') {
          console.log(`[health] ${label}: back online`);
        }
        await pool.query(
          "update browser_instances set status = case when status = 'busy' then 'busy' else 'idle' end, last_seen_at = now(), updated_at = now() where id = $1",
          [instance.id]
        );
      } else {
        console.warn(`[health] ${label} (${instance.cdp_endpoint}): offline, restarting...`);
        try {
          await launcher.ensureRunning();
          await pool.query(
            "update browser_instances set status = 'idle', last_seen_at = now(), updated_at = now() where id = $1",
            [instance.id]
          );
          console.log(`[health] ${label}: restarted`);
        } catch (err) {
          await pool.query(
            "update browser_instances set status = 'offline', updated_at = now() where id = $1",
            [instance.id]
          );
          console.error(`[health] ${label}: restart failed - ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error(`[health] browser health check failed: ${err.message}`);
  }
}

async function start() {
  if (config.chromeAutoStart) {
    try {
      await ensureBrowserInstances();
    } catch (err) {
      console.error(`[startup] Browser instances check failed: ${err.message}`);
    }
  }

  app.listen(port, () => {
    console.log(`search-boss listening on ${port}`);
    schedulerService.startTicker();
    setInterval(() => checkBrowserInstancesHealth(), HEALTH_CHECK_INTERVAL_MS);
    console.log(`[health] Browser health check every ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);
  });
}

start();

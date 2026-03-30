class DeterministicJobSyncService {
  constructor({ bossCliRunner = null, upsertJobsBatch = null, recordRunEvent = null }) {
    this.bossCliRunner = bossCliRunner;
    this.upsertJobsBatch = upsertJobsBatch;
    this.recordRunEvent = recordRunEvent;
  }

  async run({ runId }) {
    await this.#record({
      runId,
      eventId: `boss-cli-bind-started:${runId}:sync`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_bind_started',
      stage: 'deterministic_sync',
      message: 'boss cli bind started',
      payload: { mode: 'sync_jobs' }
    });

    const bindResult = await this.bossCliRunner.bindTarget({ runId });

    await this.#record({
      runId,
      eventId: `boss-cli-bind-succeeded:${runId}:sync`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_succeeded',
      stage: 'deterministic_sync',
      message: 'boss cli bind succeeded',
      payload: {
        mode: 'sync_jobs',
        command: 'target bind',
        targetId: bindResult?.session?.targetId || null
      }
    });

    await this.#record({
      runId,
      eventId: `boss-cli-command-started:${runId}:sync:joblist`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_started',
      stage: 'deterministic_sync',
      message: 'boss cli joblist started',
      payload: { mode: 'sync_jobs', command: 'joblist' }
    });

    const jobListResult = await this.bossCliRunner.listJobs({ runId });
    const rawJobs = Array.isArray(jobListResult?.jobs) ? jobListResult.jobs : [];
    const jobs = [];

    for (let i = 0; i < rawJobs.length; i++) {
      const job = rawJobs[i];
      let detailJob = null;

      if (job.encryptJobId) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
        }
        try {
          detailJob = (await this.bossCliRunner.getJobDetail({
            runId,
            jobId: job.encryptJobId
          }))?.job || null;
        } catch (error) {
          detailJob = null;
        }
      }

      jobs.push({
        encryptJobId: job.encryptJobId || '',
        jobName: detailJob?.name || job.jobName || '',
        city: detailJob?.city || job.city || '',
        salary: detailJob?.salary || job.salary || '',
        status: normalizeSyncJobStatus(job.status),
        jdText: detailJob?.description || '',
        metadata: {
          syncSource: 'boss_cli',
          detailRaw: detailJob
        }
      });
    }

    await this.#record({
      runId,
      eventId: `boss-cli-command-succeeded:${runId}:sync:joblist`,
      occurredAt: new Date().toISOString(),
      eventType: 'boss_cli_command_succeeded',
      stage: 'deterministic_sync',
      message: 'boss cli joblist succeeded',
      payload: {
        mode: 'sync_jobs',
        command: 'joblist',
        itemCount: jobs.length
      }
    });

    const syncedAt = new Date().toISOString();
    const result = await this.upsertJobsBatch({
      runId,
      eventId: `boss-cli-jobs-batch:${runId}:${syncedAt}`,
      occurredAt: syncedAt,
      jobs
    });

    return {
      ok: true,
      deterministic: true,
      stdout: JSON.stringify({
        eventType: 'jobs_batch_synced',
        syncedCount: result.syncedCount
      }),
      ...result
    };
  }

  async #record(payload) {
    if (!this.recordRunEvent) {
      return;
    }

    await this.recordRunEvent(payload);
  }
}

function normalizeSyncJobStatus(status) {
  if (!status) {
    return 'open';
  }

  const normalized = String(status).trim().toLowerCase();
  return normalized === 'online' ? 'open' : normalized;
}

module.exports = {
  DeterministicJobSyncService
};

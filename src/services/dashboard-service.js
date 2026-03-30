class DashboardService {
  constructor({ pool, bossCliRunner = null, sessionStore = null }) {
    this.pool = pool;
    this.bossCliRunner = bossCliRunner;
    this.sessionStore = sessionStore;
  }

  async getSummary() {
    const [jobsResult, candidatesResult, resumeQueueResult, recruitResult] = await Promise.all([
      this.pool.query('select count(*)::int as count from jobs'),
      this.pool.query('select count(*)::int as count from job_candidates'),
      this.pool.query(`
        select count(*)::int as count
        from job_candidates
        where resume_state in ('requested', 'received')
      `),
      this.pool.query(`
        select metrics, quotas, scraped_at
        from boss_recruit_snapshots
        where snapshot_date = current_date
        limit 1
      `)
    ]);

    const recruit = recruitResult.rows[0] || null;
    const metrics = recruit?.metrics || {};

    return {
      kpis: {
        jobs: jobsResult.rows[0]?.count || 0,
        candidates: candidatesResult.rows[0]?.count || 0,
        greetedToday: metrics.greeted?.value ?? 0,
        repliedToday: metrics.newGreetings?.value ?? 0,
        resumeRequestedToday: metrics.chatted?.value ?? 0,
        resumeReceivedToday: metrics.resumesReceived?.value ?? 0
      },
      bossRecruitData: recruit ? {
        viewed: metrics.viewed || null,
        viewedMe: metrics.viewedMe || null,
        greeted: metrics.greeted || null,
        newGreetings: metrics.newGreetings || null,
        chatted: metrics.chatted || null,
        resumesReceived: metrics.resumesReceived || null,
        contactExchanged: metrics.contactExchanged || null,
        interviewAccepted: metrics.interviewAccepted || null,
        quotas: recruit.quotas || null,
        scrapedAt: recruit.scraped_at || null
      } : null,
      queues: {
        resumePipeline: resumeQueueResult.rows[0]?.count || 0
      },
      health: {
        api: 'ok',
        database: 'connected'
      }
    };
  }

  async syncRecruitData({ metrics, quotas, scrapedAt } = {}) {
    if (!metrics && this.bossCliRunner) {
      return this._scrapeAndSync();
    }

    if (!metrics) {
      throw new Error('boss_recruit_data_missing');
    }

    return this._saveSnapshot({ metrics, quotas, scrapedAt });
  }

  async _scrapeAndSync() {
    const runId = `recruit-sync-${Date.now()}`;

    await this.bossCliRunner.bindTarget({ runId, mode: 'recruit-data' });
    const scrapeResult = await this.bossCliRunner.scrapeRecruitData({ runId });

    return this._saveSnapshot({
      metrics: scrapeResult.metrics,
      quotas: scrapeResult.quotas,
      scrapedAt: scrapeResult.scrapedAt
    });
  }

  async _saveSnapshot({ metrics, quotas, scrapedAt }) {
    const result = await this.pool.query(
      `
        insert into boss_recruit_snapshots (snapshot_date, metrics, quotas, scraped_at)
        values (current_date, $1, $2, $3)
        on conflict (snapshot_date) do update
        set metrics = excluded.metrics,
            quotas = excluded.quotas,
            scraped_at = excluded.scraped_at
        returning id, snapshot_date
      `,
      [metrics || {}, quotas || {}, scrapedAt || new Date().toISOString()]
    );

    return {
      ok: true,
      snapshotId: result.rows[0]?.id,
      snapshotDate: result.rows[0]?.snapshot_date
    };
  }
}

module.exports = {
  DashboardService
};

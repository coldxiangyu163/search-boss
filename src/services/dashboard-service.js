class DashboardService {
  constructor({ pool, bossCliRunner = null, sessionStore = null, browserInstanceManager = null }) {
    this.pool = pool;
    this.bossCliRunner = bossCliRunner;
    this.sessionStore = sessionStore;
    this.browserInstanceManager = browserInstanceManager;
  }

  async getSummary({ hrAccountId } = {}) {
    const jobFilter = hrAccountId ? `where hr_account_id = ${Number(hrAccountId)}` : '';
    const candidateFilter = hrAccountId ? `where jc.hr_account_id = ${Number(hrAccountId)}` : '';
    const resumeFilter = hrAccountId
      ? `where resume_state in ('requested', 'received') and hr_account_id = ${Number(hrAccountId)}`
      : `where resume_state in ('requested', 'received')`;
    const activeRunFilter = hrAccountId ? `and ba.hr_account_id = ${Number(hrAccountId)}` : '';

    const [jobsResult, candidatesResult, resumeQueueResult, recruitResult, activeRunResult] = await Promise.all([
      this.pool.query(`select count(*)::int as count from jobs ${jobFilter}`),
      this.pool.query(`select count(*)::int as count from job_candidates jc ${candidateFilter}`),
      this.pool.query(`
        select count(*)::int as count
        from job_candidates
        ${resumeFilter}
      `),
      this.pool.query(
        hrAccountId
          ? `select metrics, quotas, scraped_at from boss_recruit_snapshots where snapshot_date = current_date and hr_account_id = ${Number(hrAccountId)} limit 1`
          : `select metrics, quotas, scraped_at from boss_recruit_snapshots where snapshot_date = current_date order by scraped_at desc limit 1`
      ),
      this.pool.query(`
        select
          sr.id,
          sr.run_key as "runKey",
          sr.mode,
          sr.status,
          j.job_key as "jobKey",
          j.job_name as "jobName",
          sr.started_at as "startedAt",
          sr.created_at as "createdAt"
        from browser_instances bi
        join boss_accounts ba on ba.id = bi.boss_account_id
        join sourcing_runs sr on sr.id = bi.current_run_id
        left join jobs j on j.id = sr.job_id
        where ba.status = 'active'
          and bi.status = 'busy'
          and bi.current_run_id is not null
          and sr.status in ('pending', 'running')
          ${activeRunFilter}
        order by
          case sr.status when 'running' then 0 else 1 end,
          coalesce(sr.started_at, sr.created_at) desc,
          sr.id desc
        limit 1
      `)
    ]);

    const recruit = recruitResult.rows[0] || null;
    const metrics = recruit?.metrics || {};
    const activeRun = activeRunResult.rows[0] || null;

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
      activeRun,
      health: {
        api: 'ok',
        database: 'connected'
      }
    };
  }

  async syncRecruitData({ metrics, quotas, scrapedAt, hrAccountId } = {}) {
    if (!metrics && (this.bossCliRunner || this.browserInstanceManager)) {
      return this._fetchAndSync({ hrAccountId });
    }

    if (!metrics) {
      throw new Error('boss_recruit_data_missing');
    }

    return this._saveSnapshot({ metrics, quotas, scrapedAt, hrAccountId });
  }

  async _fetchAndSync({ hrAccountId } = {}) {
    let runner = this.bossCliRunner;
    let instanceId = null;

    if (hrAccountId && this.browserInstanceManager) {
      const resolved = await this.browserInstanceManager.acquireRunner({ hrAccountId });
      runner = resolved.runner;
      instanceId = resolved.instanceId;
    }

    if (!runner) {
      throw new Error('boss_recruit_data_missing');
    }

    try {
      const runId = `recruit-sync-${Date.now()}`;
      await runner.bindTarget({ runId, mode: 'recruit-data' });
      const scrapeResult = await runner.scrapeRecruitData({ runId });

      return this._saveSnapshot({
        metrics: scrapeResult.metrics,
        quotas: scrapeResult.quotas,
        scrapedAt: scrapeResult.scrapedAt,
        hrAccountId
      });
    } finally {
      if (instanceId && this.browserInstanceManager) {
        await this.browserInstanceManager.releaseInstance(instanceId).catch(() => {});
      }
    }
  }

  async _saveSnapshot({ metrics, quotas, scrapedAt, hrAccountId }) {
    const result = await this.pool.query(
      `
        insert into boss_recruit_snapshots (snapshot_date, metrics, quotas, scraped_at, hr_account_id)
        values (current_date, $1, $2, $3, $4)
        on conflict (snapshot_date, coalesce(hr_account_id, 0)) do update
        set metrics = excluded.metrics,
            quotas = excluded.quotas,
            scraped_at = excluded.scraped_at
        returning id, snapshot_date
      `,
      [metrics || {}, quotas || {}, scrapedAt || new Date().toISOString(), hrAccountId || null]
    );

    return {
      ok: true,
      snapshotId: result.rows[0]?.id,
      snapshotDate: result.rows[0]?.snapshot_date
    };
  }

  async getHrOverview({ departmentId } = {}) {
    const values = [];
    let whereClause = '';
    if (departmentId) {
      values.push(departmentId);
      whereClause = `where ha.department_id = $${values.length}`;
    }

    const result = await this.pool.query(`
      select
        ha.id as hr_account_id,
        ha.name as hr_name,
        ha.status as hr_status,
        ba.display_name as boss_account_name,
        bi.status as browser_status,
        bi.cdp_endpoint,
        (select count(*)::int from jobs where hr_account_id = ha.id) as job_count,
        (select count(*)::int from job_candidates where hr_account_id = ha.id) as candidate_count,
        (select count(*)::int from candidate_actions ca
          join job_candidates jc on jc.id = ca.job_candidate_id
          where jc.hr_account_id = ha.id
            and ca.action_type = 'greet_sent'
            and ca.created_at >= current_date) as greeted_today,
        (select count(*)::int from sourcing_runs
          where hr_account_id = ha.id
            and mode in ('followup', 'chat')
            and created_at >= current_date) as followup_today,
        (select count(*)::int from candidate_attachments cat
          join job_candidates jc on jc.id = cat.job_candidate_id
          where jc.hr_account_id = ha.id
            and cat.status = 'downloaded'
            and cat.downloaded_at >= current_date) as resumes_today,
        (select status from sourcing_runs
          where hr_account_id = ha.id
          order by created_at desc limit 1) as last_run_status,
        (select mode from sourcing_runs
          where hr_account_id = ha.id
          order by created_at desc limit 1) as last_run_mode,
        (select created_at from sourcing_runs
          where hr_account_id = ha.id and status = 'failed'
          order by created_at desc limit 1) as last_failure_at
      from hr_accounts ha
      left join boss_accounts ba on ba.hr_account_id = ha.id and ba.status = 'active'
      left join browser_instances bi on bi.boss_account_id = ba.id
      ${whereClause}
      order by ha.id
    `, values);

    return result.rows;
  }
}

module.exports = {
  DashboardService
};

class DashboardService {
  constructor({ pool, bossCliRunner = null, sessionStore = null }) {
    this.pool = pool;
    this.bossCliRunner = bossCliRunner;
    this.sessionStore = sessionStore;
  }

  async getSummary({ hrAccountId } = {}) {
    const jobFilter = hrAccountId ? `where hr_account_id = ${Number(hrAccountId)}` : '';
    const candidateFilter = hrAccountId ? `where jc.hr_account_id = ${Number(hrAccountId)}` : '';
    const resumeFilter = hrAccountId
      ? `where resume_state in ('requested', 'received') and hr_account_id = ${Number(hrAccountId)}`
      : `where resume_state in ('requested', 'received')`;

    const [jobsResult, candidatesResult, resumeQueueResult, recruitResult] = await Promise.all([
      this.pool.query(`select count(*)::int as count from jobs ${jobFilter}`),
      this.pool.query(`select count(*)::int as count from job_candidates jc ${candidateFilter}`),
      this.pool.query(`
        select count(*)::int as count
        from job_candidates
        ${resumeFilter}
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
      return this._fetchAndSync();
    }

    if (!metrics) {
      throw new Error('boss_recruit_data_missing');
    }

    return this._saveSnapshot({ metrics, quotas, scrapedAt });
  }

  async _fetchAndSync() {
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

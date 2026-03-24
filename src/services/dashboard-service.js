class DashboardService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async getSummary() {
    const [jobsResult, candidatesResult, statsResult, resumeQueueResult] = await Promise.all([
      this.pool.query('select count(*)::int as count from jobs'),
      this.pool.query('select count(*)::int as count from job_candidates'),
      this.pool.query(`
        select
          coalesce(sum(case when stat_date = current_date then greeted_count else 0 end), 0)::int as greeted_today,
          coalesce(sum(case when stat_date = current_date then responded_count else 0 end), 0)::int as replied_today,
          coalesce(sum(case when stat_date = current_date then resume_requested_count else 0 end), 0)::int as resume_requested_today,
          coalesce(sum(case when stat_date = current_date then resume_received_count else 0 end), 0)::int as resume_received_today
        from daily_job_stats
      `),
      this.pool.query(`
        select count(*)::int as count
        from job_candidates
        where resume_state in ('requested', 'received')
      `)
    ]);

    const stats = statsResult.rows[0] || {};

    return {
      kpis: {
        jobs: jobsResult.rows[0]?.count || 0,
        candidates: candidatesResult.rows[0]?.count || 0,
        greetedToday: stats.greeted_today || 0,
        repliedToday: stats.replied_today || 0,
        resumeRequestedToday: stats.resume_requested_today || 0,
        resumeReceivedToday: stats.resume_received_today || 0
      },
      queues: {
        resumePipeline: resumeQueueResult.rows[0]?.count || 0
      },
      health: {
        api: 'ok',
        database: 'connected'
      }
    };
  }
}

module.exports = {
  DashboardService
};

const { BossCliRunner } = require('./boss-cli-runner');

class BrowserInstanceManager {
  constructor({ pool, fallbackRunner = null }) {
    this.pool = pool;
    this.fallbackRunner = fallbackRunner;
    this._runners = new Map();
  }

  async acquireRunner({ hrAccountId }) {
    if (!hrAccountId) {
      return { runner: this.fallbackRunner, instanceId: null };
    }

    const result = await this.pool.query(`
      select bi.id, bi.cdp_endpoint, bi.user_data_dir, bi.download_dir, bi.status
      from browser_instances bi
      join boss_accounts ba on ba.id = bi.boss_account_id
      where ba.hr_account_id = $1
        and ba.status = 'active'
        and bi.status in ('idle', 'busy')
      order by
        case bi.status when 'idle' then 0 else 1 end,
        bi.last_seen_at desc nulls last
      limit 1
    `, [hrAccountId]);

    const instance = result.rows[0];
    if (!instance) {
      if (this.fallbackRunner) {
        return { runner: this.fallbackRunner, instanceId: null };
      }
      throw new Error('no_browser_instance_available');
    }

    await this.pool.query(
      "update browser_instances set status = 'busy', current_run_id = null, updated_at = now() where id = $1",
      [instance.id]
    );

    const runner = this._getOrCreateRunner(instance);
    return { runner, instanceId: instance.id };
  }

  async releaseInstance(instanceId) {
    if (!instanceId) return;
    await this.pool.query(
      "update browser_instances set status = 'idle', current_run_id = null, updated_at = now() where id = $1",
      [instanceId]
    );
  }

  async markInstanceBusy(instanceId, runId) {
    if (!instanceId) return;
    await this.pool.query(
      "update browser_instances set status = 'busy', current_run_id = $2, updated_at = now() where id = $1",
      [instanceId, runId]
    );
  }

  _getOrCreateRunner(instance) {
    const key = `${instance.id}:${instance.cdp_endpoint}`;
    if (this._runners.has(key)) {
      return this._runners.get(key);
    }

    const env = {
      ...process.env,
      BOSS_CDP_ENDPOINT: instance.cdp_endpoint,
      BOSS_CLI_ENABLED: 'true'
    };

    if (instance.download_dir) {
      env.BOSS_CLI_DOWNLOAD_DIR = instance.download_dir;
    }

    const runner = new BossCliRunner({ env });
    this._runners.set(key, runner);
    return runner;
  }
}

module.exports = { BrowserInstanceManager };

const { spawn } = require('node:child_process');

class NanobotRunner {
  constructor({ configPath }) {
    this.configPath = configPath;
  }

  buildCommand({ message }) {
    return {
      command: 'uv',
      args: ['run', 'nanobot', 'agent', '--config', this.configPath, '-m', message]
    };
  }

  run({ message }) {
    const { command, args } = this.buildCommand({ message });

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          const limitError = this.#extractProviderLimitError({ stdout, stderr });
          if (limitError) {
            reject(limitError);
            return;
          }

          resolve({ ok: true, stdout, stderr });
          return;
        }

        reject(new Error(stderr || stdout || `nanobot exited with code ${code}`));
      });
    });
  }

  #extractProviderLimitError({ stdout, stderr }) {
    const output = `${stdout}\n${stderr}`;

    if (/daily_limit_reached/i.test(output)) {
      return new Error('nanobot_daily_limit_reached');
    }

    if (/APIConnectionError/i.test(output) || /error calling llm/i.test(output)) {
      return new Error('nanobot_provider_error');
    }

    return null;
  }
}

module.exports = {
  NanobotRunner
};

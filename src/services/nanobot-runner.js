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
          resolve({ ok: true, stdout, stderr });
          return;
        }

        reject(new Error(stderr || stdout || `nanobot exited with code ${code}`));
      });
    });
  }
}

module.exports = {
  NanobotRunner
};

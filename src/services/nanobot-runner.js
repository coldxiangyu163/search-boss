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

  run({ message, onStdoutLine, onStderrLine }) {
    const { command, args } = this.buildCommand({ message });

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let stdoutBuffer = '';
      let stderrBuffer = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBuffer += text;
        stdoutBuffer = flushLines(stdoutBuffer, onStdoutLine);
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer += text;
        stderrBuffer = flushLines(stderrBuffer, onStderrLine);
      });

      child.on('close', (code) => {
        flushLastLine(stdoutBuffer, onStdoutLine);
        flushLastLine(stderrBuffer, onStderrLine);

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

function flushLines(buffer, callback) {
  if (!callback) {
    return buffer;
  }

  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() ?? '';
  for (const line of lines) {
    callback(line);
  }
  return remaining;
}

function flushLastLine(buffer, callback) {
  if (callback && buffer.trim()) {
    callback(buffer);
  }
}

module.exports = {
  NanobotRunner
};

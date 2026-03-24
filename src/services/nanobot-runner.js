import { spawn } from "node:child_process";
import readline from "node:readline";

function buildSyncMessage({ projectRoot, agentApiBaseUrl, agentToken }) {
  return [
    "请使用已加载的 /boss-sourcing skill。",
    "目标：只同步 BOSS 招聘端的岗位列表。",
    "不要进行寻源、沟通、简历下载。",
    `项目目录：${projectRoot}`,
    `本地后台 API：${agentApiBaseUrl}`,
    `Agent Token：${agentToken}`,
    "同步岗位后，立即调用本地后台 API `/api/agent/jobs/batch?token=...` 实时写入数据库，不要写入任何本地文件。",
    "完成后输出简短结果。",
  ].join("\n");
}

function buildSourcingMessage({ job, runId, maxPages, autoGreet, projectRoot, agentApiBaseUrl, agentToken }) {
  return [
    "请使用已加载的 /boss-sourcing skill。",
    `目标岗位：${job.jobKey}`,
    `目标岗位名称：${job.jobName}`,
    `运行任务 ID：${runId}`,
    `执行模式：/boss-sourcing --job "${job.jobKey}" --source`,
    `最大抓取页数：${maxPages}`,
    `自动打招呼：${autoGreet ? "开启" : "关闭"}`,
    `项目目录：${projectRoot}`,
    `本地后台 API：${agentApiBaseUrl}`,
    `Agent Token：${agentToken}`,
    `请在每个关键步骤立即调用 /api/agent/runs/${runId}/events、/candidates、/progress、/complete 或 /fail 实时写数据库，不要等到最后才写，不要写入任何本地文件。`,
    "不要执行沟通管理和简历下载。",
  ].join("\n");
}

function buildFollowupMessage({ jobKey, jobName, runId, projectRoot, agentApiBaseUrl, agentToken }) {
  return [
    "请使用已加载的 /boss-sourcing skill。",
    `目标岗位：${jobKey}`,
    `目标岗位名称：${jobName}`,
    `运行任务 ID：${runId}`,
    `执行模式：/boss-sourcing --job "${jobKey}" --followup`,
    `项目目录：${projectRoot}`,
    `本地后台 API：${agentApiBaseUrl}`,
    `Agent Token：${agentToken}`,
    "目标是检查已有沟通、继续跟进回复，并以获取候选人简历为核心。",
    `请在每个关键步骤立即调用 /api/agent/runs/${runId}/events、/candidates、/progress、/complete 或 /fail 实时写数据库，不要等到最后才写，不要写入任何本地文件。`,
    "不要重新做岗位同步或从头全量寻源。",
  ].join("\n");
}

function wireStream(stream, callback) {
  if (!stream || !callback) {
    return;
  }

  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    const text = line.trim();
    if (text) {
      Promise.resolve(callback(text)).catch((error) => {
        console.error("[nanobot-runner] stream callback error:", error);
      });
    }
  });
}

export function createNanobotRunner({
  configPath,
  workspace,
  agentApiBaseUrl,
  agentToken,
  command = "uv",
  spawnFn = spawn,
}) {
  const AGENT_TIMEOUT_MS = 30 * 60 * 1000;

  async function runAgent({ message, session, cwd, onStdout, onStderr }) {
    return await new Promise((resolve, reject) => {
      const child = spawnFn(
        command,
        [
          "run",
          "nanobot",
          "agent",
          "--config",
          configPath,
          "--workspace",
          workspace,
          "--session",
          session,
          "--no-markdown",
          "--message",
          message,
        ],
        {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const stdoutChunks = [];
      const stderrChunks = [];

      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(String(chunk));
      });

      wireStream(child.stdout, onStdout);
      wireStream(child.stderr, onStderr);

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, AGENT_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: signal === "SIGTERM" ? 1 : (exitCode ?? 1),
          signal,
          stdout: stdoutChunks.join(""),
          stderr: signal === "SIGTERM" ? "nanobot exceeded 30-minute timeout" : stderrChunks.join(""),
        });
      });
    });
  }

  return {
    runJobSync({ projectRoot, session, onStdout, onStderr }) {
      return runAgent({
        message: buildSyncMessage({ projectRoot, agentApiBaseUrl, agentToken }),
        session,
        cwd: projectRoot,
        onStdout,
        onStderr,
      });
    },

    runSourcing({ job, runId, maxPages, autoGreet, projectRoot, session, onStdout, onStderr }) {
      return runAgent({
        message: buildSourcingMessage({ job, runId, maxPages, autoGreet, projectRoot, agentApiBaseUrl, agentToken }),
        session,
        cwd: projectRoot,
        onStdout,
        onStderr,
      });
    },

    runFollowup({ jobKey, jobName, runId, projectRoot, session, onStdout, onStderr }) {
      return runAgent({
        message: buildFollowupMessage({ jobKey, jobName, runId, projectRoot, agentApiBaseUrl, agentToken }),
        session,
        cwd: projectRoot,
        onStdout,
        onStderr,
      });
    },
  };
}

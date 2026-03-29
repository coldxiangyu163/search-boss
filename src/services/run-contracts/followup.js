function buildAttachmentTerminalProgressPrompt(mode = '') {
  if (mode !== 'followup' && mode !== 'download') {
    return '';
  }

  if (mode === 'download') {
    return '对于 --download：完成 thread/attachment 判定后不能直接停在“已完成判定/已切换路由”这类总结。必须在同一父 run 内继续到真实下载证据：先 run-attachment(discovered)，再用 node "$PROJECT_ROOT/scripts/boss-cli.js" resume-download --run-id "$RUN_ID" --output-path "$PROJECT_ROOT/resumes/$JOB_KEY/$FILE_NAME" 下载 PDF；随后写 run-attachment(status=downloaded, storedPath, sha256) 与 run-action(resume_downloaded)，只有这些真实下载证据落地之后，才允许 run-complete。仅仅写出“已路由到 ingest context/后续会进入 ingest”不构成 run-complete 条件。';
  }

  return '对于 --followup：完成 thread/attachment 判定后不能直接停在“已完成判定/已切换路由”这类总结；必须在同一 run 内继续执行三选一：已确认附件 => 先 run-attachment，再真正启动 boss-resume-ingest（需有 spawned subagent、同 RUN_ID handoff 证据或 attachment_recorded 回写之后，才允许父 run terminal）；确认无附件且无需继续 => run-complete；存在不可恢复证据 => run-fail。仅仅写出“已路由到 ingest context/后续会进入 ingest”而没有真实 handoff 证据，不构成 run-complete 条件。';
}

module.exports = {
  buildAttachmentTerminalProgressPrompt
};

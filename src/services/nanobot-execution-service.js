class NanobotExecutionService {
  constructor({ nanobotRunner = null, recordRunEvent = null }) {
    this.nanobotRunner = nanobotRunner;
    this.recordRunEvent = recordRunEvent;
  }

  run({ runId, message }) {
    if (!runId) {
      return this.nanobotRunner.run({ message });
    }

    let sequence = 1000;
    const emitStreamEvent = async (line, stream) => {
      const sanitized = sanitizeNanobotLog(line);
      if (!sanitized) {
        return;
      }

      await this.recordRunEvent({
        runId,
        eventId: `nanobot_stream:${stream}:${sequence}`,
        sequence,
        occurredAt: new Date().toISOString(),
        eventType: 'nanobot_stream',
        stage: 'nanobot',
        message: sanitized,
        payload: { stream }
      });
      sequence += 1;
    };

    return this.nanobotRunner.run({
      message,
      onStdoutLine: (line) => emitStreamEvent(line, 'stdout'),
      onStderrLine: (line) => emitStreamEvent(line, 'stderr')
    });
  }
}

function sanitizeNanobotLog(line) {
  if (!line) {
    return '';
  }

  const trimmed = String(line).trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .replace(/\/Users\/[^\s"]+/g, '[path]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted]');
}

module.exports = {
  NanobotExecutionService
};

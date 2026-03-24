import express from "express";

export function createApp({ services } = {}) {
  const app = express();

  app.use(express.json());

  app.use("/api/agent", (request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "search-boss-admin",
    });
  });

  if (services) {
    app.get("/api/dashboard/summary", async (_request, response, next) => {
      try {
        response.json(await services.getDashboardSummary());
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/jobs", async (_request, response, next) => {
      try {
        response.json(await services.listJobs());
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/jobs/:jobId/candidates", async (request, response, next) => {
      try {
        response.json(await services.listJobCandidates(Number(request.params.jobId)));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/boss/jobs/sync", async (request, response, next) => {
      try {
        response.json(await services.syncBossJobs(request.body || {}));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/jobs/:jobId/sourcing-runs", async (request, response, next) => {
      try {
        const run = await services.startSourcingRun({
          jobId: Number(request.params.jobId),
          ...request.body,
        });
        response.status(202).json(run);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/sourcing-runs/:runId", async (request, response, next) => {
      try {
        const run = await services.getSourcingRun(Number(request.params.runId));
        if (!run) {
          response.status(404).json({ error: "Run not found" });
          return;
        }
        response.json(run);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/sourcing-runs/:runId/events", async (request, response, next) => {
      try {
        response.json(await services.listRunEvents(Number(request.params.runId)));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/scheduled-jobs", async (_request, response, next) => {
      try {
        response.json(await services.listScheduledJobs());
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/scheduled-jobs", async (request, response, next) => {
      try {
        response.status(201).json(await services.createScheduledJob(request.body || {}));
      } catch (error) {
        next(error);
      }
    });

    app.patch("/api/scheduled-jobs/:id", async (request, response, next) => {
      try {
        response.json(await services.updateScheduledJob(Number(request.params.id), request.body || {}));
      } catch (error) {
        next(error);
      }
    });

    app.delete("/api/scheduled-jobs/:id", async (request, response, next) => {
      try {
        response.json(await services.deleteScheduledJob(Number(request.params.id)));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/scheduled-jobs/:id/run", async (request, response, next) => {
      try {
        response.status(202).json(await services.runScheduledJobNow(Number(request.params.id)));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/scheduled-job-runs", async (request, response, next) => {
      try {
        const scheduledJobId = request.query.scheduledJobId ? Number(request.query.scheduledJobId) : null;
        response.json(await services.listScheduledJobRuns(scheduledJobId));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/stream", (request, response) => {
      services.openStream(response);

      request.on("close", () => {
        services.closeStream(response);
      });
    });

    app.post("/api/agent/jobs/batch", async (request, response, next) => {
      try {
        response.json(await services.agentUpsertJobs({
          token: request.query.token,
          jobs: request.body.jobs || [],
        }));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/agent/jobs/:jobKey/candidates/:geekId", async (request, response, next) => {
      try {
        const candidate = await services.agentGetCandidateState({
          token: request.query.token,
          jobKey: request.params.jobKey,
          bossEncryptGeekId: request.params.geekId,
        });

        if (!candidate) {
          response.status(404).json({ error: "Candidate not found" });
          return;
        }

        response.json(candidate);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/agent/runs/:runId/events", async (request, response, next) => {
      try {
        response.json(await services.agentLogRunEvent({
          token: request.query.token,
          runId: Number(request.params.runId),
          ...request.body,
        }));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/agent/runs/:runId/progress", async (request, response, next) => {
      try {
        response.json(await services.agentUpdateRunProgress({
          token: request.query.token,
          runId: Number(request.params.runId),
          ...request.body,
        }));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/agent/runs/:runId/candidates", async (request, response, next) => {
      try {
        response.json(await services.agentUpsertCandidate({
          token: request.query.token,
          runId: Number(request.params.runId),
          candidate: request.body,
        }));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/agent/runs/:runId/complete", async (request, response, next) => {
      try {
        response.json(await services.agentCompleteRun({
          token: request.query.token,
          runId: Number(request.params.runId),
          ...request.body,
        }));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/agent/runs/:runId/fail", async (request, response, next) => {
      try {
        response.json(await services.agentFailRun({
          token: request.query.token,
          runId: Number(request.params.runId),
          ...request.body,
        }));
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error, _request, response, _next) => {
    const status = error.statusCode || 500;
    response.status(status).json({
      error: error.message || "Internal Server Error",
    });
  });

  return app;
}

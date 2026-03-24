import fs from "node:fs/promises";
import path from "node:path";

function parseRequirementsFromMarkdown(markdown) {
  const minDegreeMatch = markdown.match(/\|\s*学历要求\s*\|\s*([^|\n]+)\s*\|/);
  const cityMatch = markdown.match(/\|\s*工作城市\s*\|\s*([^|\n]+)\s*\|/);

  return {
    minDegree: minDegreeMatch ? minDegreeMatch[1].trim() : null,
    city: cityMatch ? cityMatch[1].trim() : null,
  };
}

async function loadJson(jsonPath) {
  const raw = await fs.readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

async function loadMarkdownIfExists(projectRoot, jdPath) {
  if (!jdPath) {
    return "";
  }

  const absolutePath = path.join(projectRoot, jdPath);

  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
}

export async function importLegacyData({ pool, jsonPath, projectRoot }) {
  const legacyData = await loadJson(jsonPath);
  const client = await pool.connect();

  let jobsImported = 0;
  let candidatesImported = 0;
  let dailyStatsImported = 0;

  try {
    await client.query("BEGIN");

    const jobIdByKey = new Map();

    for (const [jobKey, job] of Object.entries(legacyData.jobs || {})) {
      const jdMarkdown = await loadMarkdownIfExists(projectRoot, job.jdPath);
      const requirements = parseRequirementsFromMarkdown(jdMarkdown);

      const jobResult = await client.query(
        `
          INSERT INTO jobs (
            job_key,
            boss_encrypt_job_id,
            job_name,
            city,
            salary,
            jd_path,
            jd_markdown,
            min_degree,
            status,
            source,
            last_synced_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', 'legacy-json', $9, NOW())
          ON CONFLICT (job_key)
          DO UPDATE SET
            boss_encrypt_job_id = EXCLUDED.boss_encrypt_job_id,
            job_name = EXCLUDED.job_name,
            city = EXCLUDED.city,
            salary = EXCLUDED.salary,
            jd_path = EXCLUDED.jd_path,
            jd_markdown = EXCLUDED.jd_markdown,
            min_degree = EXCLUDED.min_degree,
            last_synced_at = EXCLUDED.last_synced_at,
            updated_at = NOW()
          RETURNING id
        `,
        [
          jobKey,
          job.encryptJobId || null,
          job.jobName,
          requirements.city || job.city || null,
          job.salary || null,
          job.jdPath || null,
          jdMarkdown,
          requirements.minDegree,
          legacyData.metadata?.lastUpdated || null,
        ],
      );

      jobIdByKey.set(jobKey, jobResult.rows[0].id);
      jobsImported += 1;
    }

    for (const candidate of legacyData.candidates || []) {
      const jobId = jobIdByKey.get(candidate.jobName);
      if (!jobId) {
        continue;
      }

      await client.query(
        `
          INSERT INTO candidates (
            job_id,
            boss_encrypt_geek_id,
            name,
            education,
            experience,
            expected_salary,
            city,
            age,
            school,
            position,
            status,
            greeted_at,
            last_message_at,
            resume_downloaded,
            resume_path,
            notes,
            metadata,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
          )
          ON CONFLICT (job_id, boss_encrypt_geek_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            education = EXCLUDED.education,
            experience = EXCLUDED.experience,
            expected_salary = EXCLUDED.expected_salary,
            city = EXCLUDED.city,
            age = EXCLUDED.age,
            school = EXCLUDED.school,
            position = EXCLUDED.position,
            status = EXCLUDED.status,
            greeted_at = EXCLUDED.greeted_at,
            last_message_at = EXCLUDED.last_message_at,
            resume_downloaded = EXCLUDED.resume_downloaded,
            resume_path = EXCLUDED.resume_path,
            notes = EXCLUDED.notes,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `,
        [
          jobId,
          candidate.encryptGeekId,
          candidate.name,
          candidate.education || null,
          candidate.experience || null,
          candidate.expectedSalary || null,
          candidate.city || null,
          candidate.age || null,
          candidate.school || null,
          candidate.position || null,
          candidate.status || "discovered",
          candidate.greetedAt || null,
          candidate.lastMessageAt || null,
          Boolean(candidate.resumeDownloaded),
          candidate.resumePath || null,
          candidate.notes || "",
          JSON.stringify({
            source: "legacy-json",
          }),
        ],
      );

      candidatesImported += 1;
    }

    const [firstJobId] = jobIdByKey.values();
    if (firstJobId !== undefined) {
      for (const [statDate, stats] of Object.entries(legacyData.dailyStats || {})) {
        await client.query(
          `
            INSERT INTO daily_job_stats (
              job_id,
              stat_date,
              greetings_sent,
              responses_received,
              resumes_downloaded,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (job_id, stat_date)
            DO UPDATE SET
              greetings_sent = EXCLUDED.greetings_sent,
              responses_received = EXCLUDED.responses_received,
              resumes_downloaded = EXCLUDED.resumes_downloaded,
              updated_at = NOW()
          `,
          [
            firstJobId,
            statDate,
            stats.greetingsSent || 0,
            stats.responsesReceived || 0,
            stats.resumesDownloaded || 0,
          ],
        );

        dailyStatsImported += 1;
      }
    }

    await client.query("COMMIT");

    return {
      jobsImported,
      candidatesImported,
      dailyStatsImported,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

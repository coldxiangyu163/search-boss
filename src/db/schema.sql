create table if not exists jobs (
  id bigserial primary key,
  job_key text not null unique,
  boss_encrypt_job_id text not null,
  job_name text not null,
  city text,
  salary text,
  status text not null default 'open',
  source text not null default 'boss',
  jd_text text,
  custom_requirement text,
  sync_metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_boss_encrypt_job_id_key
on jobs (boss_encrypt_job_id);

create table if not exists people (
  id bigserial primary key,
  boss_encrypt_geek_id text not null unique,
  name text,
  city text,
  education text,
  experience text,
  school text,
  profile_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sourcing_runs (
  id bigserial primary key,
  run_key text not null unique,
  job_id bigint references jobs(id) on delete set null,
  mode text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_job_stats (
  id bigserial primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  stat_date date not null,
  greeted_count integer not null default 0,
  responded_count integer not null default 0,
  resume_requested_count integer not null default 0,
  resume_received_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, stat_date)
);

create table if not exists job_candidates (
  id bigserial primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  person_id bigint not null references people(id) on delete cascade,
  lifecycle_status text not null default 'discovered',
  guard_status text not null default 'active',
  source_run_id bigint references sourcing_runs(id) on delete set null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_resume_requested_at timestamptz,
  resume_request_count integer not null default 0,
  resume_state text not null default 'not_requested',
  resume_received_at timestamptz,
  resume_downloaded_at timestamptz,
  resume_path text,
  next_followup_after timestamptz,
  notes text,
  workflow_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, person_id)
);

create table if not exists candidate_messages (
  id bigserial primary key,
  job_candidate_id bigint not null references job_candidates(id) on delete cascade,
  boss_message_id text not null,
  direction text not null,
  message_type text not null default 'text',
  content_text text,
  sent_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_candidate_id, boss_message_id)
);

create table if not exists candidate_actions (
  id bigserial primary key,
  job_candidate_id bigint not null references job_candidates(id) on delete cascade,
  action_type text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists candidate_attachments (
  id bigserial primary key,
  job_candidate_id bigint not null references job_candidates(id) on delete cascade,
  boss_attachment_id text,
  file_name text,
  mime_type text,
  file_size bigint,
  sha256 text,
  stored_path text,
  status text not null default 'discovered',
  downloaded_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists candidate_attachments_boss_attachment_id_unique
  on candidate_attachments (boss_attachment_id)
  where boss_attachment_id is not null;

create unique index if not exists candidate_attachments_sha256_unique
  on candidate_attachments (sha256)
  where sha256 is not null;

create table if not exists sourcing_run_events (
  id bigserial primary key,
  run_id bigint not null references sourcing_runs(id) on delete cascade,
  attempt_id text,
  event_id text not null,
  sequence integer,
  stage text,
  event_type text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, event_id)
);

create table if not exists scheduled_jobs (
  id bigserial primary key,
  job_key text not null,
  task_type text not null,
  cron_expression text not null,
  enabled boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_key, task_type)
);

alter table scheduled_jobs
  add column if not exists payload jsonb not null default '{}'::jsonb;

create table if not exists scheduled_job_runs (
  id bigserial primary key,
  scheduled_job_id bigint not null references scheduled_jobs(id) on delete cascade,
  run_id bigint references sourcing_runs(id) on delete set null,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

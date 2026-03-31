-- Enterprise multi-account schema extension
-- Phase 1: departments, users, hr_accounts
-- Phase 2: boss_accounts, browser_instances

-- departments (flat structure)
create table if not exists departments (
  id bigserial primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- users (system login accounts)
create table if not exists users (
  id bigserial primary key,
  department_id bigint references departments(id),
  name text not null,
  email text unique,
  phone text unique,
  password_hash text not null,
  role text not null check (role in ('enterprise_admin', 'dept_admin', 'hr')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- hr_accounts (HR business accounts)
create table if not exists hr_accounts (
  id bigserial primary key,
  user_id bigint not null references users(id),
  department_id bigint references departments(id),
  manager_user_id bigint references users(id),
  name text not null,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- boss_accounts (BOSS platform accounts)
create table if not exists boss_accounts (
  id bigserial primary key,
  hr_account_id bigint not null references hr_accounts(id),
  boss_login_name text,
  display_name text,
  status text not null default 'active',
  last_login_at timestamptz,
  risk_level text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- browser_instances (browser instances bound to boss accounts)
create table if not exists browser_instances (
  id bigserial primary key,
  boss_account_id bigint not null references boss_accounts(id),
  instance_name text,
  cdp_endpoint text not null,
  user_data_dir text not null,
  download_dir text not null,
  debug_port integer,
  host text not null default 'localhost',
  status text not null default 'idle',
  current_run_id bigint,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add hr_account_id to existing business tables
alter table jobs
  add column if not exists hr_account_id bigint references hr_accounts(id);

alter table sourcing_runs
  add column if not exists hr_account_id bigint references hr_accounts(id);

alter table sourcing_runs
  add column if not exists browser_instance_id bigint references browser_instances(id);

alter table job_candidates
  add column if not exists hr_account_id bigint references hr_accounts(id);

alter table scheduled_jobs
  add column if not exists hr_account_id bigint references hr_accounts(id);

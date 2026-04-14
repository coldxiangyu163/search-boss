-- Enterprise migration script
-- Run after enterprise-schema.sql has been applied
-- This script creates default records and associates existing data

-- Step 1: Create default department
insert into departments (name)
values ('默认部门')
on conflict do nothing;

-- Step 2: Migrate legacy enterprise admins into dept admins
update users
set role = 'dept_admin'
where role = 'enterprise_admin';

-- Step 3: Create default admin user (password: admin123)
-- bcrypt hash for 'admin123': $2a$10$rQEY4VRzKQg3rHFGQN1.2OHXsQz1z6F4z0zK9LhJbVq3Q6q7nJXay
insert into users (department_id, name, email, password_hash, role)
select d.id, '默认管理员', 'admin@company.com',
       '$2a$10$rQEY4VRzKQg3rHFGQN1.2OHXsQz1z6F4z0zK9LhJbVq3Q6q7nJXay',
       'dept_admin'
from departments d
where d.name = '默认部门'
  and not exists (select 1 from users where email = 'admin@company.com')
limit 1;

-- Step 4: Create default HR user (password: hr123456)
-- bcrypt hash for 'hr123456': $2a$10$YPy1R8n9bRMqzRY0FMZQ7.8XJBK4l5G6vHn7KQ1qzP2rS3tU4vWxY
insert into users (department_id, name, email, password_hash, role)
select d.id, '默认HR', 'hr@company.com',
       '$2a$10$YPy1R8n9bRMqzRY0FMZQ7.8XJBK4l5G6vHn7KQ1qzP2rS3tU4vWxY',
       'hr'
from departments d
where d.name = '默认部门'
  and not exists (select 1 from users where email = 'hr@company.com')
limit 1;

-- Step 5: Create default HR account
insert into hr_accounts (user_id, department_id, manager_user_id, name)
select
  hr_user.id,
  hr_user.department_id,
  admin_user.id,
  '默认HR'
from users hr_user, users admin_user
where hr_user.email = 'hr@company.com'
  and admin_user.email = 'admin@company.com'
  and not exists (select 1 from hr_accounts where user_id = hr_user.id)
limit 1;

-- Step 6: Associate existing business data with default HR account
update jobs set hr_account_id = (select id from hr_accounts limit 1)
where hr_account_id is null;

update sourcing_runs set hr_account_id = (select id from hr_accounts limit 1)
where hr_account_id is null;

update job_candidates set hr_account_id = (select id from hr_accounts limit 1)
where hr_account_id is null;

update scheduled_jobs set hr_account_id = (select id from hr_accounts limit 1)
where hr_account_id is null;

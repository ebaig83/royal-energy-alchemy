-- Operations Center tables
-- Run in Supabase SQL Editor

-- 1. system_errors: captures frontend JS errors and function failures
create table if not exists system_errors (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null,          -- 'frontend' | 'function' | 'qa'
  severity      text not null default 'error',  -- 'warning' | 'error' | 'critical'
  message       text not null,
  stack         text,
  url           text,
  client_id     uuid references clients(id) on delete set null,
  function_name text,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  fingerprint   text                    -- hash for dedup
);
create index if not exists system_errors_created_at on system_errors(created_at desc);
create index if not exists system_errors_resolved    on system_errors(resolved);
create index if not exists system_errors_fingerprint on system_errors(fingerprint);

-- 2. ai_usage_logs: track every AI feature invocation
create table if not exists ai_usage_logs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  feature          text not null,   -- 'session_prep_brief' | 'attention_flags' | 'practitioner_timeline' | 'client_summary' | 'daily_briefing'
  client_id        uuid references clients(id) on delete set null,
  response_time_ms int,
  success          boolean not null default true,
  tokens_used      int,
  model            text,
  error_message    text
);
create index if not exists ai_usage_logs_created_at on ai_usage_logs(created_at desc);
create index if not exists ai_usage_logs_feature    on ai_usage_logs(feature);

-- 3. function_health_logs: periodic health check results per function
create table if not exists function_health_logs (
  id               uuid primary key default gen_random_uuid(),
  checked_at       timestamptz not null default now(),
  function_name    text not null,
  status           text not null,   -- 'ok' | 'error' | 'timeout'
  http_status      int,
  response_time_ms int,
  error_message    text
);
create index if not exists fn_health_checked_at on function_health_logs(checked_at desc);
create index if not exists fn_health_function   on function_health_logs(function_name);

-- 4. qa_results: store QA agent run results for display in Operations Center
create table if not exists qa_results (
  id         uuid primary key default gen_random_uuid(),
  run_at     timestamptz not null default now(),
  url        text,
  overall    text not null,  -- 'PASS' | 'FAIL' | 'WARN'
  summary    jsonb,          -- { pass, fail, warn, skip, total }
  checks     jsonb,          -- array of check results
  console_errors jsonb,
  network_fails  jsonb,
  git_sha    text,
  triggered_by text          -- 'github_actions' | 'manual'
);
create index if not exists qa_results_run_at on qa_results(run_at desc);

-- RLS: service role bypasses all; no public access
alter table system_errors     enable row level security;
alter table ai_usage_logs     enable row level security;
alter table function_health_logs enable row level security;
alter table qa_results        enable row level security;

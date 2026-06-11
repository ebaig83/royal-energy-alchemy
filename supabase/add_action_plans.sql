-- Add action_plans table
-- Run in Supabase SQL Editor

create table if not exists action_plans (
  id                    uuid    default gen_random_uuid() primary key,
  client_id             uuid    not null references clients(id) on delete cascade,
  session_id            uuid    references sessions(id) on delete set null,
  immediate_steps       text,
  products_recommended  text,
  provider_referrals    text,
  environmental_actions text,
  aftercare_tasks       text,
  priority              text    default 'medium' check (priority in ('high','medium','low')),
  due_date              date,
  status                text    default 'active' check (status in ('draft','active','completed')),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table action_plans enable row level security;

create policy "deny_anon_action_plans"  on action_plans for all to anon          using (false) with check (false);
create policy "deny_auth_action_plans"  on action_plans for all to authenticated  using (false) with check (false);

grant select, insert, update, delete on action_plans to service_role;

create trigger set_action_plans_updated_at
  before update on action_plans
  for each row execute procedure moddatetime(updated_at);

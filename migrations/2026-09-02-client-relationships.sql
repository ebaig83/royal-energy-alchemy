-- Private CRM links between known clients and explicitly related historical clients.
-- Direction: client_id is the known/anchor client; related_client_id is the described person.
create table if not exists client_relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  related_client_id uuid not null references clients(id) on delete cascade,
  relationship_type text not null,
  relationship_label text not null,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_relationships_distinct_clients check (client_id <> related_client_id),
  constraint client_relationships_unique_direction unique (client_id, related_client_id, relationship_type)
);

create index if not exists client_relationships_client_idx on client_relationships(client_id);
create index if not exists client_relationships_related_idx on client_relationships(related_client_id);

drop trigger if exists client_relationships_updated_at on client_relationships;
create trigger client_relationships_updated_at
  before update on client_relationships
  for each row execute function touch_updated_at();

alter table client_relationships enable row level security;
drop policy if exists "deny_all_client_relationships" on client_relationships;
create policy "deny_all_client_relationships" on client_relationships as restrictive
  for all to anon, authenticated using (false);

grant select, insert, update, delete on client_relationships to service_role;

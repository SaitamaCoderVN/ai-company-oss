-- AI Agent Company — Core Schema (single-tenant)
-- Run this in the Supabase SQL Editor once after creating your project.

-- ─── agent_status ─────────────────────────────────────────────
create table if not exists agent_status (
  id            uuid primary key default gen_random_uuid(),
  agent_role    text not null unique,
  status        text default 'idle',
  current_task  text,
  last_heartbeat timestamptz default now(),
  metadata      jsonb
);

alter table agent_status enable row level security;

create policy "service_role full access on agent_status"
  on agent_status for all
  to service_role
  using (true)
  with check (true);

create policy "anon can read agent_status"
  on agent_status for select
  to anon
  using (true);

create policy "anon can write agent_status"
  on agent_status for insert
  to anon
  with check (true);

create policy "anon can update agent_status"
  on agent_status for update
  to anon
  using (true)
  with check (true);

-- ─── tasks ────────────────────────────────────────────────────
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  assigned_role text not null,
  input         text not null,
  output        text,
  status        text default 'queued',
  created_at    timestamptz default now(),
  completed_at  timestamptz
);

alter table tasks enable row level security;

create policy "service_role full access on tasks"
  on tasks for all
  to service_role
  using (true)
  with check (true);

create policy "anon can read tasks"
  on tasks for select
  to anon
  using (true);

create policy "anon can insert tasks"
  on tasks for insert
  to anon
  with check (true);

create policy "anon can update tasks"
  on tasks for update
  to anon
  using (true)
  with check (true);

-- ─── agent_memory ─────────────────────────────────────────────
create table if not exists agent_memory (
  id          uuid primary key default gen_random_uuid(),
  agent_role  text not null,
  content     text not null,
  importance  real default 0.5,
  created_at  timestamptz default now()
);

alter table agent_memory enable row level security;

create policy "service_role full access on agent_memory"
  on agent_memory for all
  to service_role
  using (true)
  with check (true);

create policy "anon can read agent_memory"
  on agent_memory for select
  to anon
  using (true);

create policy "anon can insert agent_memory"
  on agent_memory for insert
  to anon
  with check (true);

-- ─── Enable Realtime ──────────────────────────────────────────
alter publication supabase_realtime add table agent_status;
alter publication supabase_realtime add table tasks;

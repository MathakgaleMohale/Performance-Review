-- Projects step 1: BOQs and cable schedules saved inside a project.
-- Run once in the Supabase SQL editor AFTER supabase/projects.sql. Safe to run again.

create table if not exists project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  kind text not null,               -- boq, cable (later: design_pack)
  title text not null,
  data jsonb not null default '{}'::jsonb,  -- the tool's full working state
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_items_project_idx on project_items (project_id, kind);

drop trigger if exists project_items_touch on project_items;
create trigger project_items_touch before update on project_items
for each row execute function projects_touch_updated_at();

alter table project_items enable row level security;
drop policy if exists "Signed-in users manage project_items" on project_items;
create policy "Signed-in users manage project_items" on project_items
for all to authenticated using (true) with check (true);

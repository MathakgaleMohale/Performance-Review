-- Projects workspace (Engineering Tools) — run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run). Safe to run again.
-- Stages: Site Visit → Design → BOQ → Procurement → Installation → Quality Control → As-Built → Handover

create or replace function projects_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1. Projects ------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  site_name text,                       -- matches sites.name when the project is for a portfolio site
  location text,
  capacity_kwp numeric,
  battery_kwh numeric,
  system_type text,                     -- PPA, RTO, Cash, …
  owner text,                           -- project manager / engineer
  stage text not null default 'Site Visit',
  status text not null default 'Active',-- Active, On hold, Complete, Cancelled
  start_date date,
  target_date date,                     -- target handover
  description text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_stage_idx on projects (stage);
drop trigger if exists projects_touch on projects;
create trigger projects_touch before update on projects for each row execute function projects_touch_updated_at();

-- 2. One row per project + stage: status and notes ----------------------
create table if not exists project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  status text not null default 'Not started', -- Not started, In progress, Done
  notes_html text,
  completed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (project_id, stage)
);
drop trigger if exists project_stages_touch on project_stages;
create trigger project_stages_touch before update on project_stages for each row execute function projects_touch_updated_at();

-- 3. Checklist tasks ------------------------------------------------------
create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  title text not null,
  assignee text,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  sort integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_tasks_project_idx on project_tasks (project_id, stage);
drop trigger if exists project_tasks_touch on project_tasks;
create trigger project_tasks_touch before update on project_tasks for each row execute function projects_touch_updated_at();

-- 4. Files & photos -------------------------------------------------------
create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  file_path text not null,              -- path in the "project-files" bucket
  file_name text,
  file_size bigint,
  file_type text,
  caption text,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists project_files_project_idx on project_files (project_id, stage);

-- 5. Links to records in other tools -------------------------------------
create table if not exists project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  link_type text not null,              -- template_report, library_doc
  ref_id uuid not null,
  label text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (project_id, stage, link_type, ref_id)
);
create index if not exists project_links_project_idx on project_links (project_id, stage);

-- Signed-in portal users can read and write everything above
do $$
declare t text;
begin
  foreach t in array array['projects','project_stages','project_tasks','project_files','project_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Signed-in users manage %s" on %I', t, t);
    execute format('create policy "Signed-in users manage %s" on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- 6. Storage: private bucket for files, public bucket for images inside notes
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 104857600)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-images', 'project-images', true, 10485760)
on conflict (id) do nothing;

drop policy if exists "Signed-in read project files" on storage.objects;
create policy "Signed-in read project files" on storage.objects for select to authenticated
using (bucket_id in ('project-files', 'project-images'));

drop policy if exists "Signed-in upload project files" on storage.objects;
create policy "Signed-in upload project files" on storage.objects for insert to authenticated
with check (bucket_id in ('project-files', 'project-images'));

drop policy if exists "Signed-in update project files" on storage.objects;
create policy "Signed-in update project files" on storage.objects for update to authenticated
using (bucket_id in ('project-files', 'project-images'));

drop policy if exists "Signed-in delete project files" on storage.objects;
create policy "Signed-in delete project files" on storage.objects for delete to authenticated
using (bucket_id in ('project-files', 'project-images'));

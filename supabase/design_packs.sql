-- Design packs saved on the website (Engineering Tools → Design Pack Generator, and inside projects)
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run again.
-- Needs supabase/projects.sql to have been run first (a pack can belong to a project).

create or replace function design_packs_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1. Saved packs (editable drafts) -------------------------------------------
create table if not exists design_packs (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled design pack',
  project_id uuid references projects(id) on delete set null,   -- empty when saved from Engineering Tools
  doc_no text,
  revision text,
  data jsonb not null default '{}'::jsonb,   -- everything entered in the generator; files are in storage (paths in data)
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_packs_project_idx on design_packs (project_id);
create index if not exists design_packs_updated_idx on design_packs (updated_at desc);
drop trigger if exists design_packs_touch on design_packs;
create trigger design_packs_touch before update on design_packs for each row execute function design_packs_touch_updated_at();

-- 2. Issued PDFs (one row each time a pack is compiled) -----------------------
create table if not exists design_pack_issues (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references design_packs(id) on delete cascade,
  revision text,
  filename text not null,
  file_path text not null,                   -- path in the design-packs bucket
  size_bytes bigint,
  issued_by text,
  issued_at timestamptz not null default now()
);
create index if not exists design_pack_issues_pack_idx on design_pack_issues (pack_id, issued_at desc);

-- Signed-in portal users can read and write both tables
do $$
declare t text;
begin
  foreach t in array array['design_packs','design_pack_issues'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Signed-in users manage %s" on %I', t, t);
    execute format('create policy "Signed-in users manage %s" on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- 3. Storage: private bucket for drawings, photos, manual attachments and issued PDFs
--    Layout: <pack id>/drawings/…  <pack id>/photos/…  <pack id>/library/…  <pack id>/issued/…
insert into storage.buckets (id, name, public, file_size_limit)
values ('design-packs', 'design-packs', false, 209715200)
on conflict (id) do nothing;

drop policy if exists "Signed-in read design packs" on storage.objects;
create policy "Signed-in read design packs" on storage.objects for select to authenticated
using (bucket_id = 'design-packs');

drop policy if exists "Signed-in upload design packs" on storage.objects;
create policy "Signed-in upload design packs" on storage.objects for insert to authenticated
with check (bucket_id = 'design-packs');

drop policy if exists "Signed-in update design packs" on storage.objects;
create policy "Signed-in update design packs" on storage.objects for update to authenticated
using (bucket_id = 'design-packs');

drop policy if exists "Signed-in delete design packs" on storage.objects;
create policy "Signed-in delete design packs" on storage.objects for delete to authenticated
using (bucket_id = 'design-packs');

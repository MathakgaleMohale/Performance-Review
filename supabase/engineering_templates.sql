-- Engineering Templates library – run this once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)

-- 1. Table -------------------------------------------------------------
create table if not exists engineering_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Other',
  name text not null,
  description text,
  version text,
  file_path text,          -- path inside the storage bucket
  file_name text,          -- original file name (used for downloads)
  file_size bigint,
  file_type text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_templates_category_idx on engineering_templates (category);

create or replace function engineering_templates_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists engineering_templates_set_updated_at on engineering_templates;
create trigger engineering_templates_set_updated_at
before update on engineering_templates
for each row execute function engineering_templates_set_updated_at();

-- Only signed-in portal users can see or change templates
alter table engineering_templates enable row level security;

drop policy if exists "Signed-in users manage templates" on engineering_templates;
create policy "Signed-in users manage templates"
on engineering_templates for all
to authenticated
using (true)
with check (true);

-- 2. Private storage bucket for the files (50 MB per file) ---------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('engineering-templates', 'engineering-templates', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "Signed-in read engineering templates" on storage.objects;
create policy "Signed-in read engineering templates"
on storage.objects for select to authenticated
using (bucket_id = 'engineering-templates');

drop policy if exists "Signed-in upload engineering templates" on storage.objects;
create policy "Signed-in upload engineering templates"
on storage.objects for insert to authenticated
with check (bucket_id = 'engineering-templates');

drop policy if exists "Signed-in update engineering templates" on storage.objects;
create policy "Signed-in update engineering templates"
on storage.objects for update to authenticated
using (bucket_id = 'engineering-templates');

drop policy if exists "Signed-in delete engineering templates" on storage.objects;
create policy "Signed-in delete engineering templates"
on storage.objects for delete to authenticated
using (bucket_id = 'engineering-templates');

-- Check: should return the new bucket
select id, public, file_size_limit from storage.buckets where id = 'engineering-templates';

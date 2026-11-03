-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Turns on Supabase Realtime for the tables the dashboard shows, so open
-- dashboards refresh by themselves when the sync (or an upload) changes data.

do $$
declare t text;
begin
  foreach t in array array['sites', 'performance', 'offtake_guarantees'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Check: should list the three tables
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
